// packages/voice/src/voiceBackend.ts — the local-voice seam (Phase D).
//
// The provider-seam law: voice sits behind an interface with a LOCAL adapter (free tier). The local
// adapter is whisper.cpp (STT) + Silero VAD (turn/barge-in) + Kokoro (TTS), all on-device ($0). Those
// need native binaries + a microphone, so the real adapter is wired on a machine that has them.
//
// The CONTRACT types (VoiceBackend / VoiceBackendEvents) live in the app's src/shared/voiceBackend.ts —
// the seam both sides agree on (the app never imports this package; this package implements the shared
// types). Re-exported here so in-package consumers keep a single import path. The no-op stub stays here
// (runtime code must not live in src/shared) so the rest of the package (and its tests) compile and run
// without audio hardware. Summon-never-always-on: start()/stop() are gated behind a deliberate Mode.

import type { VoiceBackend } from '../../../src/shared/voiceBackend';

export type { VoiceBackend, VoiceBackendEvents } from '../../../src/shared/voiceBackend';

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
