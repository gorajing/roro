// src/renderer/voice/voiceBackend.ts — the local-voice seam (Phase D).
//
// The provider-seam law: voice sits behind an interface with a LOCAL adapter (free tier). The local
// adapter is whisper.cpp (STT) + Silero VAD (turn/barge-in) + Kokoro (TTS), all on-device ($0). Those
// need native binaries + a microphone, so the real adapter is wired on a machine that has them; this
// file defines the contract + a no-op stub so the rest of the renderer (and tests) compile and run
// without audio hardware. Summon-never-always-on: start()/stop() are gated behind a deliberate Mode.

export interface VoiceBackendEvents {
  /** VAD rising edge — fire driver.poke()/ear-perk BEFORE any STT result (the ≤80ms local tell). */
  onSpeechStart(): void;
  /** Live partial transcript (for the caption tell); NOT routed to the orchestrator. */
  onPartialTranscript(text: string): void;
  /** A COMMITTED utterance — the only thing that reaches voiceTurnRouter (mouth-not-brain). */
  onFinalTranscript(text: string): void;
}

export interface VoiceBackend {
  /** Open the mic + VAD + STT and begin emitting events. Summoned, never always-on. */
  start(events: VoiceBackendEvents): Promise<void>;
  /** Release the mic and stop all processing. */
  stop(): Promise<void>;
  /** Speak text via TTS (Kokoro / a voice-pack cosmetic). Resolves when playback finishes. */
  speak(text: string): Promise<void>;
  /** Hard demo/presentation mute — committed transcripts are ignored while muted. */
  setMuted(muted: boolean): void;
  /** True when the real on-device backend is available (binaries + mic); false for the stub. */
  readonly available: boolean;
}

/**
 * A no-op backend for environments without the native binaries / a mic (CI, headless, the typed-only
 * tier). It emits nothing and speaks nothing; `available` is false so the UI can show "voice needs a
 * mic" rather than silently failing. The real local backend replaces this when present.
 */
export function createStubVoiceBackend(): VoiceBackend {
  return {
    available: false,
    async start(): Promise<void> {
      /* no hardware -> nothing to start */
    },
    async stop(): Promise<void> {
      /* no-op */
    },
    async speak(): Promise<void> {
      /* no TTS without the local model */
    },
    setMuted(): void {
      /* no-op */
    },
  };
}
