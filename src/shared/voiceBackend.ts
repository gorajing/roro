// src/shared/voiceBackend.ts — the voice seam CONTRACT (types only).
//
// The provider-seam law: voice sits behind an interface with a LOCAL adapter (free tier). The full
// on-device implementation (Silero VAD + whisper STT + Kokoro TTS over WASM) lives in packages/voice —
// a standalone sub-package deliberately OUTSIDE the app's dependency graph, so a fresh clone / CI
// `npm ci` never pays its ~510MB of model-runtime deps. This module is the one thing both sides agree
// on: packages/voice implements VoiceBackend against these types (it imports them from here), and the
// app re-wires a backend through this same surface when voice re-integrates (see packages/voice/README.md).
//
// INVARIANT: src/shared must NEVER import from packages/voice — the dependency arrow only points
// packages/voice -> src/shared. Types only here: no runtime voice code may live app-side.

export interface VoiceBackendEvents {
  /** VAD rising edge — fire driver.poke()/ear-perk BEFORE any STT result (the ≤80ms local tell). */
  onSpeechStart(): void;
  /** Live partial transcript (for the caption tell); NOT routed to the orchestrator. */
  onPartialTranscript(text: string): void;
  /** A COMMITTED utterance — the only thing that reaches the voice turn router (mouth-not-brain). */
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
