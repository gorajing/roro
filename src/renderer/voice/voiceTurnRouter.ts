// src/renderer/voice/voiceTurnRouter.ts — the MOUTH-NOT-BRAIN router (Phase D).
//
// THE law: voice never decides. A committed utterance routes THROUGH the orchestrator's turnRun
// (recall -> decide -> execute -> remember) exactly like a typed task — NEVER a speech-to-speech
// model that bypasses recall/decide/remember. This file is the pure control core; the actual
// STT/VAD/TTS (whisper.cpp + Silero + Kokoro) live behind VoiceBackend (voiceBackend.ts) and need
// native binaries + a mic, so they're integrated on a real machine. This logic is hardware-free.
//
// Barge-in rides C1's preempt backend: a final utterance mid-run cancels the active turn (cancelTask)
// and the queued utterance fires on that turn's runEnd. (Typed auto-barge-in was deferred to here.)

export interface VoiceTurnDeps {
  /** Route a committed transcript through the orchestrator (window.companion.turnRun). */
  turnRun(transcript: string): void;
  /** Preempt the active run for barge-in (window.companion.cancelTask). */
  cancelTask(): void;
  /** Whether a turn/run is currently active (from runLifecycle). */
  isRunActive(): boolean;
}

export interface VoiceTurnRouter {
  /** A committed (final) utterance from STT/VAD. */
  onFinalTranscript(text: string): void;
  /** A turn ended (the push stream's runEnd) — fires any queued barge-in. */
  onRunEnd(): void;
}

export function makeVoiceTurnRouter(deps: VoiceTurnDeps): VoiceTurnRouter {
  let pendingBargeIn: string | null = null;

  return {
    onFinalTranscript(text: string): void {
      const t = text.trim();
      if (!t) return; // silence / noise -> nothing to run
      if (deps.isRunActive()) {
        // Barge-in: preempt the current run; the queued utterance starts on its runEnd. The latest
        // utterance supersedes any earlier queued one.
        pendingBargeIn = t;
        deps.cancelTask();
      } else {
        deps.turnRun(t); // mouth-not-brain: straight through the orchestrator
      }
    },

    onRunEnd(): void {
      if (pendingBargeIn === null) return;
      const t = pendingBargeIn;
      pendingBargeIn = null;
      deps.turnRun(t);
    },
  };
}
