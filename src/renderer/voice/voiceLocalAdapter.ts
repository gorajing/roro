// src/renderer/voice/voiceLocalAdapter.ts — the on-device VoiceBackend (Phase D).
//
// The local adapter is whisper.cpp (STT) + Silero VAD (turn/barge-in) + Kokoro (TTS), all on-device,
// $0. Those need native binaries + a microphone, so the actual engine is injected on a machine that
// has them (NativeVoiceEngine). Without it, `available` is false and start()/speak() FAIL LOUD with an
// actionable message — never a silent no-op that looks like a dead mic. This keeps the seam (and its
// tests) runnable with no audio hardware, ready for the native engine to slot in.

import type { VoiceBackend, VoiceBackendEvents } from './voiceBackend';

/**
 * The native STT/VAD/TTS engine the local adapter drives. Implemented on a real device against
 * whisper.cpp / Silero / Kokoro bindings; `start` is handed the backend's event sink to emit into.
 */
export interface NativeVoiceEngine {
  start(emit: VoiceBackendEvents): Promise<void>;
  stop(): Promise<void>;
  speak(text: string): Promise<void>;
  setMuted(muted: boolean): void;
}

export interface LocalVoiceBackendOptions {
  /** Probe for the native binaries + mic. Defaults to false (no engine wired here). */
  detect?: () => boolean;
  /** The native engine, present only on a device that has the binaries. */
  engine?: NativeVoiceEngine;
}

const UNAVAILABLE =
  'local voice backend unavailable — native whisper.cpp/Silero/Kokoro binaries and a microphone are ' +
  'required (run on a device with them, or use the typed Ask input)';

export function createLocalVoiceBackend(opts: LocalVoiceBackendOptions = {}): VoiceBackend {
  const available = Boolean(opts.detect?.() && opts.engine);
  const engine = opts.engine;

  return {
    available,
    async start(events: VoiceBackendEvents): Promise<void> {
      if (!available || !engine) throw new Error(UNAVAILABLE);
      await engine.start(events);
    },
    async stop(): Promise<void> {
      // Safe even when unavailable — teardown must never throw.
      await engine?.stop();
    },
    async speak(text: string): Promise<void> {
      if (!available || !engine) throw new Error(UNAVAILABLE);
      await engine.speak(text);
    },
    setMuted(muted: boolean): void {
      engine?.setMuted(muted);
    },
  };
}
