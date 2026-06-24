import { describe, it, expect, vi } from 'vitest';
import { createVadVoiceEngine, type VadCallbacks, type VadSource, type Transcribe } from './vadVoiceEngine';
import type { VoiceBackendEvents } from './voiceBackend';

// A fake VAD source: captures the callbacks so the test can drive speech edges; records lifecycle.
function fakeVad() {
  const f = { started: false, destroyed: false, cb: undefined as VadCallbacks | undefined };
  const create = async (cb: VadCallbacks): Promise<VadSource> => {
    f.cb = cb;
    return { async start() { f.started = true; }, async destroy() { f.destroyed = true; } };
  };
  return { f, create };
}
function sink() {
  const ev = { speechStart: 0, partials: [] as string[], finals: [] as string[] };
  const events: VoiceBackendEvents = {
    onSpeechStart: () => { ev.speechStart++; },
    onPartialTranscript: (t) => ev.partials.push(t),
    onFinalTranscript: (t) => ev.finals.push(t),
  };
  return { ev, events };
}

describe('createVadVoiceEngine — VAD-only engine (the ear-perk + mic lifecycle, Phase 1)', () => {
  it('opens the VAD on start() and emits onSpeechStart on a VAD rising edge (the ear-perk)', async () => {
    const { f, create } = fakeVad();
    const engine = createVadVoiceEngine(create);
    const { ev, events } = sink();
    await engine.start(events);
    expect(f.started).toBe(true); // mic opened only on summon (near-zero-idle)
    f.cb?.onSpeechStart();
    expect(ev.speechStart).toBe(1);
  });

  it('without a transcriber wired, speech-end is a no-op (no STT)', async () => {
    const { f, create } = fakeVad();
    const engine = createVadVoiceEngine(create); // no transcribe injected
    const { ev, events } = sink();
    await engine.start(events);
    f.cb?.onSpeechStart();
    await f.cb?.onSpeechEnd(new Float32Array(0));
    expect(ev.finals).toEqual([]); // no transcript without STT
  });

  it('a muted engine still runs the mic but suppresses the ear-perk', async () => {
    const { f, create } = fakeVad();
    const engine = createVadVoiceEngine(create);
    const { ev, events } = sink();
    await engine.start(events);
    engine.setMuted(true);
    f.cb?.onSpeechStart();
    expect(ev.speechStart).toBe(0); // muted -> the cat doesn't react
    engine.setMuted(false);
    f.cb?.onSpeechStart();
    expect(ev.speechStart).toBe(1);
  });

  it('stop() destroys the VAD (releases the mic) and detaches', async () => {
    const { f, create } = fakeVad();
    const engine = createVadVoiceEngine(create);
    const { ev, events } = sink();
    await engine.start(events);
    await engine.stop();
    expect(f.destroyed).toBe(true);
    f.cb?.onSpeechStart(); // emissions after stop are dropped
    expect(ev.speechStart).toBe(0);
  });

  it('speak() is a no-op when no speaker is injected', async () => {
    const engine = createVadVoiceEngine(fakeVad().create);
    await expect(engine.speak('hi')).resolves.toBeUndefined();
  });

  it('barge-in (Phase 4): a VAD speech-start halts the cat’s TTS via speaker.stop() (talk over the cat → it stops)', async () => {
    const { f, create } = fakeVad();
    let stopped = 0;
    const speaker = { speak: async () => { /* noop */ }, stop: () => { stopped++; } };
    const engine = createVadVoiceEngine(create, undefined, speaker);
    await engine.start(sink().events);
    f.cb?.onSpeechStart(); // the user starts speaking while the cat may be talking
    expect(stopped).toBe(1); // barge-in: the cat's mouth is halted at the moment speech is detected
  });

  it('a MUTED engine does NOT barge-in (deaf cat keeps talking)', async () => {
    const { f, create } = fakeVad();
    let stopped = 0;
    const speaker = { speak: async () => { /* noop */ }, stop: () => { stopped++; } };
    const engine = createVadVoiceEngine(create, undefined, speaker);
    await engine.start(sink().events);
    engine.setMuted(true);
    f.cb?.onSpeechStart();
    expect(stopped).toBe(0); // muted → the cat ignores the mic entirely, including barge-in
  });

  it('delegates speak() to the injected speaker and stop() halts it (mouth wiring, barge-in-ready)', async () => {
    const { create } = fakeVad();
    const spoken: string[] = [];
    let stopped = 0;
    const speaker = { speak: async (t: string) => { spoken.push(t); }, stop: () => { stopped++; } };
    const engine = createVadVoiceEngine(create, undefined, speaker);
    await engine.start(sink().events);
    await engine.speak('on it');
    expect(spoken).toEqual(['on it']); // mouth: message → speak
    await engine.stop();
    expect(stopped).toBe(1); // teardown halts any in-flight speech
  });

  it('stop() DURING a slow createVad() discards the late VAD — no mic opened, no ear-perk', async () => {
    // A deferred createVad: it resolves only when we call `resolve` — simulating a slow model load.
    let resolve!: () => void;
    const slowVad = { started: false, destroyed: false, cb: undefined as VadCallbacks | undefined };
    const create = (cb: VadCallbacks): Promise<VadSource> => {
      slowVad.cb = cb;
      return new Promise<VadSource>((r) => { resolve = () => r({ async start() { slowVad.started = true; }, async destroy() { slowVad.destroyed = true; } }); });
    };
    const engine = createVadVoiceEngine(create);
    const { ev, events } = sink();
    const starting = engine.start(events); // in-flight (createVad pending)
    await engine.stop(); // teardown BEFORE the model finishes loading
    resolve(); // createVad finally resolves
    await starting;
    expect(slowVad.started).toBe(false); // the late VAD's mic was never started
    expect(slowVad.destroyed).toBe(true); // and it was destroyed (no leak)
    slowVad.cb?.onSpeechStart();
    expect(ev.speechStart).toBe(0); // no late ear-perk after teardown
  });
});

describe('createVadVoiceEngine — STT over the utterance (Phase 2)', () => {
  const PCM = new Float32Array([0.1, -0.2, 0.3]); // a stand-in 16kHz utterance buffer

  it('transcribes the utterance on speech-end and COMMITS the final to onFinalTranscript (mouth-not-brain)', async () => {
    const { f, create } = fakeVad();
    const seen: Float32Array[] = [];
    const transcribe: Transcribe = async (audio) => { seen.push(audio); return 'add a logout route'; };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    f.cb?.onSpeechStart();
    await f.cb?.onSpeechEnd(PCM);
    expect(seen).toEqual([PCM]); // the utterance PCM reached the transcriber
    expect(ev.finals).toEqual(['add a logout route']); // committed utterance -> turnRun
  });

  it('emits partial transcripts during transcription (the caption tell) but only the final is committed', async () => {
    const { f, create } = fakeVad();
    const transcribe: Transcribe = async (_audio, o) => {
      o?.onPartial?.('add a');
      o?.onPartial?.('add a logout');
      return 'add a logout route';
    };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    await f.cb?.onSpeechEnd(PCM);
    expect(ev.partials).toEqual(['add a', 'add a logout']); // live caption tell, NOT routed
    expect(ev.finals).toEqual(['add a logout route']); // exactly one committed final
  });

  it('a muted engine does NOT transcribe on speech-end (deaf cat — no compute, no final)', async () => {
    const { f, create } = fakeVad();
    const seen: Float32Array[] = [];
    const transcribe: Transcribe = async (audio) => { seen.push(audio); return 'secret'; };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    engine.setMuted(true);
    await f.cb?.onSpeechEnd(PCM);
    expect(seen).toEqual([]); // muted -> the utterance is never even transcribed
    expect(ev.finals).toEqual([]);
  });

  it('does NOT commit an empty/whitespace transcript (silence/noise -> no turnRun)', async () => {
    const { f, create } = fakeVad();
    const transcribe: Transcribe = async () => '   ';
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    await f.cb?.onSpeechEnd(PCM);
    expect(ev.finals).toEqual([]); // whitespace-only is not a committed utterance
  });

  it('stop() DURING transcription discards the late final (no onFinalTranscript after teardown)', async () => {
    const { f, create } = fakeVad();
    let resolveT!: (s: string) => void;
    const transcribe: Transcribe = () => new Promise<string>((r) => { resolveT = r; });
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    const ending = f.cb?.onSpeechEnd(PCM); // transcription in-flight
    await engine.stop(); // teardown DURING transcription
    resolveT('add a logout route'); // resolves late
    await ending;
    expect(ev.finals).toEqual([]); // the late final must not reach turnRun after teardown
  });

  it('a mute toggled AFTER speech-start but before transcription drops the final (capture-window taint)', async () => {
    const { f, create } = fakeVad();
    const seen: Float32Array[] = [];
    const transcribe: Transcribe = async (a) => { seen.push(a); return 'add a logout route'; };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    f.cb?.onSpeechStart(); // speaking begins (unmuted)
    engine.setMuted(true); // user mutes mid-speech...
    engine.setMuted(false); // ...then unmutes before finishing
    await f.cb?.onSpeechEnd(PCM); // speech ends unmuted
    expect(seen).toEqual([]); // tainted during capture → not even decoded
    expect(ev.finals).toEqual([]); // ...and nothing committed
  });

  it('a mute toggled DURING transcription drops the final, even if unmuted before decode resolves', async () => {
    const { f, create } = fakeVad();
    let resolveT!: (s: string) => void;
    const transcribe: Transcribe = () => new Promise<string>((r) => { resolveT = r; });
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    const ending = f.cb?.onSpeechEnd(PCM); // decode in-flight (NOT muted at speech-end)
    engine.setMuted(true); // user mutes mid-decode...
    engine.setMuted(false); // ...then unmutes before it resolves
    resolveT('add a logout route');
    await ending;
    expect(ev.finals).toEqual([]); // muting an in-flight utterance means "don't act on this" — dropped
  });

  it('a mute during decode suppresses the tainted utterance’s PARTIALS too (not just the final)', async () => {
    const { f, create } = fakeVad();
    let emitPartial!: (t: string) => void;
    let resolveT!: (s: string) => void;
    const transcribe: Transcribe = (_a, opts) => {
      emitPartial = (t) => opts?.onPartial?.(t); // drive the engine's wrapped onPartial on demand
      return new Promise<string>((r) => { resolveT = r; });
    };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    f.cb?.onSpeechStart();
    const ending = f.cb?.onSpeechEnd(PCM);
    emitPartial('add a'); // partial BEFORE any mute → shown
    engine.setMuted(true); // taints this utterance
    engine.setMuted(false); // unmute — but the utterance stays tainted
    emitPartial('add a logout'); // partial AFTER taint → must be suppressed
    resolveT('add a logout route');
    await ending;
    expect(ev.partials).toEqual(['add a']); // only the pre-taint partial; the post-taint one is gone
    expect(ev.finals).toEqual([]); // and the final is dropped
  });

  it('overlapping decodes keep INDEPENDENT taint — a later utterance never un-taints an earlier muted one', async () => {
    const { f, create } = fakeVad();
    const resolvers: ((s: string) => void)[] = [];
    const transcribe: Transcribe = () => new Promise<string>((r) => { resolvers.push(r); });
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);

    // Utterance A: speech → end → decode A in-flight.
    f.cb?.onSpeechStart();
    const endA = f.cb?.onSpeechEnd(new Float32Array([1]));
    engine.setMuted(true); // taints A's in-flight decode...
    engine.setMuted(false); // ...A stays tainted after unmute

    // Utterance B (its OWN record): fully unmuted, decode B in-flight while A is still pending.
    f.cb?.onSpeechStart();
    const endB = f.cb?.onSpeechEnd(new Float32Array([2]));

    resolvers[0]('muted utterance A'); // A resolves first
    resolvers[1]('clean utterance B'); // then B
    await Promise.all([endA, endB]);

    // A is dropped (tainted), B commits — B's onSpeechStart must NOT have un-tainted A's in-flight decode.
    expect(ev.finals).toEqual(['clean utterance B']);
  });

  it('a transcription failure is contained (drops the utterance, keeps listening) — no unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { f, create } = fakeVad();
    const transcribe: Transcribe = async () => { throw new Error('whisper model exploded'); };
    const engine = createVadVoiceEngine(create, transcribe);
    const { ev, events } = sink();
    await engine.start(events);
    await expect(f.cb?.onSpeechEnd(PCM)).resolves.toBeUndefined(); // contained: never rejects
    expect(ev.finals).toEqual([]); // nothing committed on failure
    expect(warn).toHaveBeenCalled(); // but the fault is SURFACED, not swallowed silently
    warn.mockRestore();
  });
});
