import { describe, it, expect } from 'vitest';
import { createKokoroVoiceEngine, type Synthesize, type SynthChunk } from './kokoroVoiceEngine';

// The play + lipsync + stop/barge-in CORE — tested with fakes (no ONNX, no WebAudio, no mic). Kokoro
// synthesis (kokoroSynthesize.ts) and the real AudioContext stay thin glue behind these injected seams.

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const chunk = (fill = 0.5, len = 240): SynthChunk => ({ samples: new Float32Array(len).fill(fill), sampleRate: 24000 });

/** A fake WebAudio graph: sources fire onended on the next microtask after start(). */
function fakeAudio() {
  const sources: Array<{ started: boolean; stopped: boolean; onended: (() => void) | null }> = [];
  const sink = {
    sources,
    createBuffer: (_ch: number, len: number, sr: number) =>
      ({ length: len, sampleRate: sr, numberOfChannels: 1, copyToChannel() { /* fake */ } }) as unknown as AudioBuffer,
    createBufferSource: () => {
      const s = {
        buffer: null as AudioBuffer | null,
        onended: null as (() => void) | null,
        started: false,
        stopped: false,
        connect() { /* fake node */ },
        disconnect() { /* fake node */ },
        start() { this.started = true; queueMicrotask(() => this.onended?.()); },
        stop() { this.stopped = true; },
      };
      sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    },
    createAnalyser: () =>
      ({
        fftSize: 1024,
        smoothingTimeConstant: 0,
        connect() { /* fake node */ },
        disconnect() { /* fake node */ },
        getFloatTimeDomainData: (a: Float32Array) => a.fill(0.5), // constant 0.5 → RMS 0.5 → mouth > 0
      }) as unknown as AnalyserNode,
    destination: {} as AudioNode,
  };
  return sink;
}

function fakeLipSync() {
  return { started: 0, stopped: 0, amplitudes: [] as number[], start() { this.started++; }, stop() { this.stopped++; }, setAmplitude(v: number) { this.amplitudes.push(v); } };
}

/** A controllable rAF: fires only the FIRST scheduled frame (once), so the mouth loop ticks deterministically. */
function fireOnceFrame() {
  let fired = false;
  return { requestFrame: (cb: () => void) => { if (!fired) { fired = true; queueMicrotask(cb); } return 1; }, cancelFrame() { /* fake */ } };
}

function makeEngine(synthesize: Synthesize, voiceId?: () => string) {
  const audio = fakeAudio();
  const lipSync = fakeLipSync();
  const { requestFrame, cancelFrame } = fireOnceFrame();
  const engine = createKokoroVoiceEngine({ synthesize, audio, lipSync, voiceId, requestFrame, cancelFrame });
  return { engine, audio, lipSync };
}

describe('createKokoroVoiceEngine — play + lipsync + stop/barge-in', () => {
  it('synthesizes, plays each chunk IN ORDER, drives the mouth, then resolves', async () => {
    const synth: Synthesize = async function* () { yield chunk(); yield chunk(); };
    const { engine, audio, lipSync } = makeEngine(synth);
    await engine.speak('hello world');
    expect(audio.sources.length).toBe(2); // both chunks played
    expect(audio.sources.every((s) => s.started)).toBe(true);
    expect(lipSync.started).toBe(1); // mouth opened for the utterance
    expect(lipSync.stopped).toBe(1); // ...and reset at the end
    expect(lipSync.amplitudes.some((v) => v > 0)).toBe(true); // the mouth was actually driven
  });

  it('passes the injected voiceId to synthesize (Phase 5 voice packs)', async () => {
    const seen: string[] = [];
    const synth: Synthesize = async function* (_t, opts) { seen.push(opts.voice); yield chunk(); };
    const { engine } = makeEngine(synth, () => 'bm_george');
    await engine.speak('hi');
    expect(seen).toEqual(['bm_george']);
  });

  it('defaults the voice to af_heart when no voiceId is injected', async () => {
    const seen: string[] = [];
    const synth: Synthesize = async function* (_t, opts) { seen.push(opts.voice); yield chunk(); };
    const { engine } = makeEngine(synth);
    await engine.speak('hi');
    expect(seen).toEqual(['af_heart']);
  });

  it('stop() halts mid-stream — the remaining chunks are NOT played and the mouth resets', async () => {
    const gate = deferred();
    const synth: Synthesize = async function* () { yield chunk(); await gate.promise; yield chunk(); };
    const { engine, audio, lipSync } = makeEngine(synth);
    const speaking = engine.speak('one. two.');
    await Promise.resolve(); await Promise.resolve(); // let chunk 1 play
    engine.stop(); // barge-in
    gate.resolve(); // the generator would now yield chunk 2...
    await speaking;
    expect(audio.sources.length).toBe(1); // ...but it is never played
    expect(audio.sources[0].stopped).toBe(true); // the in-flight source was halted
    expect(lipSync.stopped).toBeGreaterThanOrEqual(1); // mouth reset
  });

  it('speak() again stops the previous utterance first (one mouth at a time)', async () => {
    const gateA = deferred();
    const synthA: Synthesize = async function* () { yield chunk(); await gateA.promise; yield chunk(); };
    const audio = fakeAudio();
    const lipSync = fakeLipSync();
    const { requestFrame, cancelFrame } = fireOnceFrame();
    let which: Synthesize = synthA;
    const synth: Synthesize = (t, o) => which(t, o);
    const engine = createKokoroVoiceEngine({ synthesize: synth, audio, lipSync, requestFrame, cancelFrame });

    const a = engine.speak('first');
    await Promise.resolve(); await Promise.resolve(); // chunk 1 of A plays
    const aSourceCount = audio.sources.length;
    which = async function* () { yield chunk(); }; // B's synth
    const b = engine.speak('second'); // must stop A first
    gateA.resolve();
    await Promise.all([a, b]);
    expect(audio.sources[0].stopped).toBe(true); // A's source halted by the re-speak
    expect(audio.sources.length).toBeGreaterThan(aSourceCount); // B played at least one chunk
  });

  it('a superseded utterance finishing LATE does not reset the newer (still-speaking) utterance’s mouth', async () => {
    // A's synth blocks BEFORE its first yield (Kokoro synth is not abortable mid-ONNX); B then supersedes it.
    const gateA = deferred();
    const gateB = deferred();
    const synthA: Synthesize = async function* () { await gateA.promise; yield chunk(); };
    const synthB: Synthesize = async function* () { yield chunk(); await gateB.promise; }; // B stays "speaking"
    const audio = fakeAudio();
    const lipSync = fakeLipSync();
    const { requestFrame, cancelFrame } = fireOnceFrame();
    let which: Synthesize = synthA;
    const engine = createKokoroVoiceEngine({ synthesize: (t, o) => which(t, o), audio, lipSync, requestFrame, cancelFrame });

    const a = engine.speak('A'); // A's synth pending (no yield yet)
    await Promise.resolve();
    which = synthB;
    const b = engine.speak('B'); // supersedes A; B plays chunk 1 then awaits gateB (still active)
    await Promise.resolve(); await Promise.resolve();
    const stoppedWhileBActive = lipSync.stopped;

    gateA.resolve(); // A's synth yields late → A's loop breaks (stopped) → A's finally runs
    await a;
    expect(lipSync.stopped).toBe(stoppedWhileBActive); // A's late finally must NOT reset B's live mouth

    gateB.resolve(); // B finishes cleanly on its own
    await b;
    expect(lipSync.stopped).toBe(stoppedWhileBActive + 1); // exactly one final reset — B's own
  });

  it('empty synthesis resolves cleanly with no playback', async () => {
    const synth: Synthesize = async function* () { /* yields nothing */ };
    const { engine, audio } = makeEngine(synth);
    await engine.speak('');
    expect(audio.sources.length).toBe(0);
  });

  it('stop() is idempotent and safe before/after any speak', () => {
    const synth: Synthesize = async function* () { yield chunk(); };
    const { engine } = makeEngine(synth);
    expect(() => { engine.stop(); engine.stop(); }).not.toThrow();
  });
});
