// packages/voice/src/kokoroVoiceEngine.ts — the cat's MOUTH: play synthesized speech + drive lip-sync.
//
// The play/lipsync/stop/barge-in CORE, with everything hardware/model-specific injected so it's unit-
// testable with fakes: `synthesize` (Kokoro raw-ONNX, an AsyncIterable so streaming + one-shot look the
// same), `audio` (the shared AudioContext), `lipSync` (AmplitudeLipSync). It implements only speak()+stop()
// of the NativeVoiceEngine surface; vadVoiceEngine composes it as the injected speaker.
//
// Invariants: ONE utterance at a time (speak() stops the previous); stop() is instant + idempotent and is
// the Phase-4 barge-in entry point; it NEVER closes/suspends the AudioContext (shared with the mic/VAD) —
// only source.stop()+disconnect(). The mouth is reset to 0 on every stop (AmplitudeLipSync.stop()).

export type SynthChunk = { samples: Float32Array; sampleRate: number };

/** Synthesize one utterance as a stream of PCM chunks. AsyncIterable models streaming AND one-shot alike. */
export type Synthesize = (text: string, opts: { voice: string; signal?: AbortSignal }) => AsyncIterable<SynthChunk>;

/** The minimal WebAudio surface the player needs — lets a fake AudioContext satisfy it in tests. */
export interface AudioSink {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createAnalyser(): AnalyserNode;
  readonly destination: AudioNode;
}

/** AmplitudeLipSync satisfies this exactly (start/stop/setAmplitude). */
export interface LipSyncDriver {
  start(): void;
  stop(): void;
  setAmplitude(v: number): void;
}

export interface KokoroVoiceEngineDeps {
  synthesize: Synthesize;
  audio: AudioSink;
  lipSync: LipSyncDriver;
  /** Phase-5 voice-pack injectable; default () => 'af_heart'. */
  voiceId?: () => string;
  /** Injectable rAF for deterministic tests; defaults to the real one. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface KokoroSpeaker {
  speak(text: string): Promise<void>;
  stop(): void;
}

const MOUTH_GAIN = 3.2; // RMS→mouth-open scaling; AmplitudeLipSync applies its own smoothing on top

export function createKokoroVoiceEngine(deps: KokoroVoiceEngineDeps): KokoroSpeaker {
  const { synthesize, audio, lipSync } = deps;
  const voiceId = deps.voiceId ?? (() => 'af_heart');
  const requestFrame = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((id) => cancelAnimationFrame(id));

  // The single live utterance. `stop()` flips `token.stopped` (seen by the for-await + onended) and tears down.
  interface Utterance {
    stopped: boolean;
    controller: AbortController;
    source: AudioBufferSourceNode | null;
    frame: number | null;
    settleChunk: (() => void) | null; // resolves the in-flight playChunk promise so speak() unblocks on stop
  }
  let current: Utterance | null = null;

  function teardown(u: Utterance): void {
    if (u.frame !== null) { cancelFrame(u.frame); u.frame = null; }
    if (u.source) {
      try { u.source.stop(); } catch { /* stopping an already-ended node throws — ignore */ }
      u.source.disconnect();
      u.source = null;
    }
    lipSync.stop(); // resets the mouth to 0 immediately
    u.settleChunk?.(); // unblock any awaiting playChunk
    u.settleChunk = null;
  }

  function startMouthLoop(u: Utterance, analyser: AnalyserNode): void {
    const td = new Float32Array(analyser.fftSize);
    const tick = (): void => {
      if (u.stopped) return;
      analyser.getFloatTimeDomainData(td);
      let sum = 0;
      for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
      lipSync.setAmplitude(Math.min(1, Math.sqrt(sum / td.length) * MOUTH_GAIN));
      u.frame = requestFrame(tick);
    };
    u.frame = requestFrame(tick);
  }

  function playChunk(u: Utterance, c: SynthChunk, analyser: AnalyserNode): Promise<void> {
    return new Promise<void>((resolve) => {
      u.settleChunk = resolve; // so stop() can unblock this await immediately
      const buf = audio.createBuffer(1, c.samples.length, c.sampleRate);
      buf.copyToChannel(c.samples, 0);
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.connect(analyser);
      src.onended = () => { u.settleChunk = null; resolve(); }; // natural end (also fires on stop())
      u.source = src;
      src.start();
    });
  }

  return {
    async speak(text: string): Promise<void> {
      this.stop(); // one mouth at a time — halt any prior utterance first
      const u: Utterance = { stopped: false, controller: new AbortController(), source: null, frame: null, settleChunk: null };
      current = u;

      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0; // AmplitudeLipSync already smooths — avoid double-smoothing
      analyser.connect(audio.destination);
      lipSync.start();
      startMouthLoop(u, analyser);

      try {
        for await (const c of synthesize(text, { voice: voiceId(), signal: u.controller.signal })) {
          if (u.stopped) break; // barge-in / re-speak: drop the rest without playing
          await playChunk(u, c, analyser);
          if (u.stopped) break;
        }
      } finally {
        // Release THIS utterance's OWN nodes (idempotent if stop() already tore them down).
        if (u.frame !== null) { cancelFrame(u.frame); u.frame = null; }
        if (u.source) { try { u.source.stop(); } catch { /* ignore */ } u.source.disconnect(); u.source = null; }
        analyser.disconnect();
        // Only the utterance that STILL owns the mouth resets it. A SUPERSEDED utterance (current !== u —
        // its non-abortable synth/fetch finished late after a re-speak or stop()) must NOT reset the mouth:
        // that would kill the lip-sync of the newer utterance now speaking. stop()→teardown() already reset
        // it at supersession time.
        if (current === u) { current = null; lipSync.stop(); }
      }
    },

    stop(): void {
      const u = current;
      if (!u) return;
      u.stopped = true;
      current = null;
      u.controller.abort(); // signal the synth generator to abandon any in-flight chunk
      teardown(u);
    },
  };
}
