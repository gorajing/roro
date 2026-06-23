// src/renderer/voice/vadVoiceEngine.ts — the VAD-only NativeVoiceEngine (Phase 1).
//
// The first real engine: it drives the cat's EARS off Silero VAD. On a speech rising edge it emits
// onSpeechStart — the <=80ms "I heard you" tell, BEFORE any transcript. STT (-> onFinalTranscript) lands
// in Phase 2 (the VAD's onSpeechEnd hands the utterance PCM to whisper); TTS (speak) in Phase 3. The VAD
// SOURCE is injected (createSileroVad in production via @ricky0123/vad-web; a fake in tests) so this
// logic — the ear-perk, the mute gate, the mic lifecycle — is unit-testable without audio hardware.
//
// near-zero-idle: the mic opens only on start() (summon) and is fully released on stop().

import type { NativeVoiceEngine } from './voiceLocalAdapter';
import type { VoiceBackendEvents } from './voiceBackend';

export interface VadCallbacks {
  /** Speech rising edge — the ear-perk trigger. */
  onSpeechStart(): void;
  /** Trailing silence — end of an utterance (Phase 2 will run STT over its audio here). */
  onSpeechEnd(): void;
}

/** A running voice-activity detector over the mic (Silero). */
export interface VadSource {
  /** Begin listening (opens the mic). */
  start(): Promise<void>;
  /** Stop + release the mic. */
  destroy(): Promise<void>;
}

/** Construct a VAD over the mic, wired to the given callbacks. */
export type CreateVad = (callbacks: VadCallbacks) => Promise<VadSource>;

export function createVadVoiceEngine(createVad: CreateVad): NativeVoiceEngine {
  let vad: VadSource | undefined;
  let emit: VoiceBackendEvents | undefined;
  let muted = false;
  // A generation token guards the async window in start(): createVad() can take a while to fetch + load
  // the Silero model. stop() (or a re-summon) bumps `generation`, so a start() whose createVad resolves
  // LATE is discarded (its VAD destroyed) instead of stranding/opening the mic after teardown.
  let generation = 0;

  return {
    async start(events: VoiceBackendEvents): Promise<void> {
      const gen = ++generation;
      emit = events;
      const source = await createVad({
        onSpeechStart() {
          if (!muted && generation === gen) emit?.onSpeechStart(); // ear-perk; muted/superseded → silent
        },
        onSpeechEnd() {
          /* Phase 2: run whisper STT over the utterance, then emit?.onFinalTranscript(text) */
        },
      });
      if (generation !== gen) {
        await source.destroy().catch(() => undefined); // stop()/re-summon happened while loading — discard
        return;
      }
      vad = source;
      await vad.start();
    },
    async stop(): Promise<void> {
      generation++; // invalidate any in-flight start()
      const v = vad;
      vad = undefined;
      emit = undefined; // detach first so any in-flight callback is dropped
      await v?.destroy();
    },
    async speak(): Promise<void> {
      /* Phase 3: Kokoro TTS */
    },
    setMuted(m: boolean): void {
      muted = m;
    },
  };
}
