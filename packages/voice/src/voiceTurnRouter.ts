// packages/voice/src/voiceTurnRouter.ts — the MOUTH-NOT-BRAIN router (Phase D).
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
  /**
   * Route a committed transcript through the orchestrator (window.companion.turnRun). May return the
   * dispatch promise; if it rejects before any runEnd, the router unlatches so voice can recover.
   */
  turnRun(transcript: string): unknown;
  /** Preempt the active run for barge-in (window.companion.cancelTask). */
  cancelTask(): void;
  /** Whether a turn/run is currently active (from runLifecycle). */
  isRunActive(): boolean;
}

export interface VoiceTurnRouter {
  /** A committed (final) utterance from STT/VAD. */
  onFinalTranscript(text: string): void;
  /**
   * A turn ended (the push stream's runEnd). Pass the ended run's id so ONLY this router's own run
   * advances the queue — an unrelated turn (typed Ask, answer) ending must not clear the voice latch.
   * Omit it (legacy callers) to advance unconditionally.
   */
  onRunEnd(runId?: string): void;
}

export function makeVoiceTurnRouter(deps: VoiceTurnDeps): VoiceTurnRouter {
  let pendingBargeIn: string | null = null;
  // Synchronous in-flight latch. isRunActive() reads runState.active, which only flips when the
  // pushed run.started echoes back — turnRun spends time in recall/decide FIRST. Without this latch,
  // two rapid finals in that gap would both see "idle" and dispatch concurrent turns. `dispatched`
  // closes the window the instant we call turnRun; it clears on the run's end.
  let dispatched = false;
  // The id of the run THIS router dispatched, learned when turnRun resolves {runId}. onRunEnd matches
  // against it so an UNRELATED turn ending can't clear our latch or drain our queued barge-in.
  let activeRunId: string | null = null;
  // Monotonic dispatch epoch. turnRun resolves asynchronously, so a SUPERSEDED dispatch's late
  // resolution/rejection must not write activeRunId or advance() the current run — each callback
  // only acts if its epoch is still the latest.
  let epoch = 0;
  const runInFlight = (): boolean => dispatched || deps.isRunActive();

  // The tracked run ended (or its dispatch died): invalidate any in-flight dispatch (bump epoch),
  // clear the latch, and if a barge-in is queued fire it now. Used by both onRunEnd and the dispatch-
  // rejection handler so a queued utterance is never stranded (it must not replay on a later run).
  function advance(): void {
    epoch++;
    dispatched = false;
    activeRunId = null;
    if (pendingBargeIn === null) return;
    const t = pendingBargeIn;
    pendingBargeIn = null;
    dispatch(t);
  }

  // Dispatch through the orchestrator (mouth-not-brain). The latch is held EXACTLY while a real
  // dispatch promise is outstanding: turnRun returns Promise<{runId}>, so a thenable means a turn is
  // in flight — latch until it ends so a racing second final barges in instead of double-running. A
  // non-thenable return means the bridge was unavailable (optional-chain no-op): nothing dispatched,
  // so do NOT latch — a later final must stay free to retry, not wedge into cancel-only barge-ins.
  // On resolve, record the runId so onRunEnd can match; if it REJECTS before any runEnd, advance()
  // clears the latch and drains any queued barge-in so voice recovers and no utterance is stranded.
  function dispatch(t: string): void {
    const r = deps.turnRun(t) as unknown;
    if (r && typeof (r as PromiseLike<unknown>).then === 'function') {
      dispatched = true;
      activeRunId = null; // not known until the dispatch promise resolves the {runId} ticket
      const myEpoch = ++epoch;
      (r as PromiseLike<{ runId?: string } | undefined>).then(
        (res) => { if (myEpoch === epoch) activeRunId = res && typeof res.runId === 'string' ? res.runId : null; },
        () => { if (myEpoch === epoch) advance(); },
      );
    }
  }

  return {
    onFinalTranscript(text: string): void {
      const t = text.trim();
      if (!t) return; // silence / noise -> nothing to run
      if (runInFlight()) {
        // Barge-in: preempt the current run; the queued utterance starts on its runEnd. The latest
        // utterance supersedes any earlier queued one.
        pendingBargeIn = t;
        deps.cancelTask();
      } else {
        dispatch(t);
      }
    },

    onRunEnd(runId?: string): void {
      // Only OUR run's end advances the queue. Once activeRunId is known, a mismatched id is an
      // unrelated turn — ignore it. Before it's known (dispatch promise still pending) or when no id
      // is supplied, advance: no other voice run can be in flight, so the end can only be ours.
      if (activeRunId !== null && runId !== undefined && runId !== activeRunId) return;
      advance();
    },
  };
}
