import { describe, it, expect, vi } from 'vitest';
import { createVadVoiceEngine, type VadCallbacks, type VadSource } from './vadVoiceEngine';
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
  const ev = { speechStart: 0, finals: [] as string[] };
  const events: VoiceBackendEvents = {
    onSpeechStart: () => { ev.speechStart++; },
    onPartialTranscript: () => {},
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

  it('does NOT emit onFinalTranscript yet (STT is Phase 2) — speech-end is a no-op', async () => {
    const { f, create } = fakeVad();
    const engine = createVadVoiceEngine(create);
    const { ev, events } = sink();
    await engine.start(events);
    f.cb?.onSpeechStart();
    f.cb?.onSpeechEnd();
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

  it('speak() is a no-op in Phase 1 (TTS is Phase 3)', async () => {
    const engine = createVadVoiceEngine(fakeVad().create);
    await expect(engine.speak('hi')).resolves.toBeUndefined();
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
