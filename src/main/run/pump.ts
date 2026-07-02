// src/main/run/pump.ts — the per-dispatch PUMP machine (docs/plans/run-state-machine.md).
//
// pumpRun owns ONE executor dispatch: it pumps the source's ActionEvent stream into injected
// sinks and owns the Stop watchdog, the runId re-stamp, the mid-run destructive guard, and the
// no-verdict synthesis. The PUMP tracks process truth (has the stream drained?) while the TURN
// tracks UI truth (has runEnd been pushed?) — a watchdog Stop ends the UI at 1.5s while the
// single-executor slot stays held until the aborted stream truly drains (closed).
//
// PINNED micro-ordering inside the loop: stamp → guard → emit → activity/digest → terminal
// hooks → remember. Preserve exactly.

import { isActivityEvent, silentRunWarning } from '../../executor/formatDrift';
import type { ActionEvent } from '../../shared/events';
import type { EndCause } from './turnState';

/** How long after an abort we force a terminal event so Stop is provably terminal. */
export const STOP_WATCHDOG_MS = 1500;

export type TerminalEvent = Extract<ActionEvent, { kind: 'run.completed' | 'run.failed' }>;

/**
 * The four reachable pump states (replacing the terminalSeen/uiEnded/slotReleased boolean combos):
 *  - flowing:   events stream to the sinks (abortPending: Stop sent, watchdog armed, child alive)
 *  - finishing: the STREAM produced its verdict; the tail of the stream still flows
 *  - draining:  the UI is terminal (watchdog / destructive block) — events are DROPPED while the
 *               stream is drained to its true end, so the slot can't free under a live child
 *  - closed:    the stream truly ended; the slot is freed. The slot frees ONLY here.
 */
export type PumpPhase =
  | { kind: 'flowing'; abortPending: boolean }
  | { kind: 'finishing'; terminal: TerminalEvent }
  | { kind: 'draining'; uiCause: EndCause }
  | { kind: 'closed'; outcome: EndCause };

/**
 * A terminal the PUMP synthesizes when the stream didn't provide one. There is deliberately NO
 * success arm (the c5 invariant): a stream that is stopped, blocked, throws, or ends without a
 * verdict can only ever synthesize run.failed — never a fabricated run.completed (which would
 * mislead the user AND persist a false success to memory).
 */
export type TerminalSynthesis =
  | { kind: 'stopped' } // watchdog-forced Stop
  | { kind: 'blocked'; reason: string } // unapproved destructive command mid-run
  | { kind: 'no-verdict' } // the stream ended silently — fail loud
  | { kind: 'stream-threw'; error: string }; // the for-await itself threw

const NO_VERDICT_ERROR = 'the coding agent ended without a result (no completion or failure was reported)';

function synthesisError(s: TerminalSynthesis): string {
  switch (s.kind) {
    case 'stopped':
      return 'stopped';
    case 'blocked':
      return `blocked unapproved destructive command: ${s.reason}`;
    case 'no-verdict':
      return NO_VERDICT_ERROR;
    case 'stream-threw':
      return s.error;
  }
}

/**
 * Today's executor stream shape — the W6 seam: an SDK-backed executor only has to provide the
 * same AsyncIterable of canonical events. The AbortController is created inside the dispatch
 * section and handed to the pump, which owns its lifecycle from here.
 */
export interface RunSource {
  events: AsyncIterable<ActionEvent>;
  controller: AbortController;
}

export interface PumpSinks {
  /** Push one (re-stamped) event to the renderer. The caller MAY also accumulate it (digest). */
  emit: (e: ActionEvent) => void;
  /** Fire-and-forget memory persistence — must never stall the event stream. */
  remember: (e: ActionEvent) => void;
  /** Native "job done" notification (visible even when the window is hidden / floating). */
  notify: (ok: boolean, detail?: string) => void;
  /** Terminal-verdict hooks (fact extraction + executor-facts ask) — STREAM verdicts only, never
   *  synthesized ones. */
  onVerdict: (terminal: TerminalEvent) => void;
  /** Mid-run destructive guard: a non-null reason blocks the run (unapproved destructive command). */
  guard: (e: ActionEvent) => string | null;
  /** End the TURN (pushes runEnd) with the pump's cause. The pump calls this exactly once. */
  endUi: (cause: EndCause) => void;
  /** Free the single-executor slot. The pump calls this exactly once, at closed — never before
   *  the stream has truly ended (the child is confirmed gone). */
  releaseSlot: () => void;
}

function terminalEventText(e: TerminalEvent): string | undefined {
  if (e.kind === 'run.completed') return e.finalText;
  return e.error;
}

/**
 * Pump one dispatched run to its true end. Resolves when the stream ends (closed) — the UI may
 * have ended long before (watchdog / destructive block), in which case late events are dropped
 * while the stream drains.
 */
export async function pumpRun(runId: string, source: RunSource, sinks: PumpSinks): Promise<void> {
  let phase: PumpPhase = { kind: 'flowing', abortPending: false };
  let synthesized: TerminalSynthesis | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  // TS can't see closure writes to `phase` (the abort listener / watchdog endUi mutate it between
  // loop iterations), so sites in the main body read it through this to avoid stale narrowing.
  const currentPhase = (): PumpPhase => phase;

  // UI-terminal: push the synthesized failure (if forced) + end the turn (runEnd) exactly once.
  // Does NOT free the executor slot — a watchdog-forced Stop is terminal to the USER while the
  // possibly-still-alive child keeps the single-executor slot, so no concurrent run can start.
  const endUi = (forced?: TerminalSynthesis): void => {
    if (phase.kind === 'draining' || phase.kind === 'closed') return;
    let uiCause: EndCause;
    if (forced) {
      if (phase.kind !== 'finishing') {
        const error = synthesisError(forced);
        sinks.emit({ kind: 'run.failed', runId, ok: false, error, ts: Date.now() });
        sinks.notify(false, error);
      }
      uiCause = forced.kind === 'stopped' ? { kind: 'stopped' } : { kind: 'failed', error: synthesisError(forced) };
    } else if (phase.kind === 'finishing') {
      uiCause =
        phase.terminal.kind === 'run.completed'
          ? { kind: 'completed' }
          : { kind: 'failed', error: phase.terminal.error };
    } else if (synthesized) {
      uiCause = { kind: 'failed', error: synthesisError(synthesized) };
    } else {
      // An aborted stream that drained before the watchdog fired — a quiet stop, no forced event.
      uiCause = { kind: 'stopped' };
    }
    phase = { kind: 'draining', uiCause };
    sinks.endUi(uiCause);
  };

  // Stop watchdog: if the child doesn't honor abort within STOP_WATCHDOG_MS, make the run
  // terminal to the UI (so Stop is provably terminal). It does NOT free the slot — the slot
  // frees when the stream truly ends. (The executor adapter SIGKILLs its child on abort, so the
  // stream normally ends fast.) The GLOBAL setTimeout is resolved at fire time — never cached at
  // module load — so fake-timer suites (stopSlotRetention) intercept it.
  source.controller.signal.addEventListener(
    'abort',
    () => {
      if (phase.kind === 'flowing') phase = { kind: 'flowing', abortPending: true };
      watchdog = setTimeout(() => endUi({ kind: 'stopped' }), STOP_WATCHDOG_MS);
    },
    { once: true },
  );

  try {
    let activityCount = 0; // format-drift tripwire: a completed run that mapped ZERO activity is suspicious
    for await (const ev of source.events) {
      // Already UI-terminal (watchdog fired / destructive block): DROP late events but keep
      // DRAINING the stream until it truly ends, so releaseSlot (in finally) only frees the
      // single-executor slot once the child has actually exited (the abort signal kills it).
      // Breaking here would free the slot while an aborted-but-slow child is still alive,
      // admitting a concurrent run against the same repo.
      if (currentPhase().kind === 'draining') continue;
      // Re-stamp to the orchestrator's runId — the executors mint their OWN run ids, but the
      // slot (and so Stop/cancelTask) is keyed by THIS runId. Without this, a targeted Stop from
      // the renderer (which sees the event's runId) never finds the controller. One id per turn.
      const stamped = { ...ev, runId } as ActionEvent;
      const guardReason = sinks.guard(stamped);
      if (guardReason) {
        source.controller.abort();
        endUi({ kind: 'blocked', reason: guardReason });
        continue;
      }
      sinks.emit(stamped);
      if (isActivityEvent(stamped.kind)) activityCount++;
      // Terminal verdict from the STREAM: notify + hand to the verdict hooks (fact extraction,
      // executor-facts ask).
      if (stamped.kind === 'run.completed' || stamped.kind === 'run.failed') {
        phase = { kind: 'finishing', terminal: stamped };
        const drift = silentRunWarning(activityCount, stamped.kind);
        if (drift) console.warn(drift);
        sinks.notify(stamped.kind === 'run.completed', terminalEventText(stamped));
        sinks.onVerdict(stamped);
      }
      // Fire-and-forget memory persistence so it never stalls the event stream.
      sinks.remember(stamped);
    }
    if (phase.kind === 'flowing' && !source.controller.signal.aborted) {
      // The executor stream ended with NO terminal event. Both adapters emit a terminal on
      // success AND failure (+ exitAccounting.ts fails loud on a nonzero/killed exit), so a
      // MISSING verdict means the child died/exited without completing — FAIL LOUD, never
      // synthesize a false success (which would also persist a fabricated outcome to memory).
      // This is the catch-all behind the adapter accounting.
      synthesized = { kind: 'no-verdict' };
      const failed: ActionEvent = {
        kind: 'run.failed',
        runId,
        ok: false,
        error: NO_VERDICT_ERROR,
        ts: Date.now(),
      };
      sinks.emit(failed);
      sinks.notify(false, failed.error);
      sinks.remember(failed);
    }
  } catch (err) {
    // The executors normally translate failures into a run.failed event, but guard the
    // for-await itself so a thrown error still produces a terminal event + runEnd.
    if (phase.kind === 'flowing') {
      synthesized = { kind: 'stream-threw', error: (err as Error).message };
      sinks.emit({
        kind: 'run.failed',
        runId,
        ok: false,
        error: (err as Error).message,
        ts: Date.now(),
      });
      sinks.notify(false, (err as Error).message);
    }
  } finally {
    // The stream has truly ended: free the slot, then end the UI if the watchdog hasn't already
    // (a tolerated idempotent no-op when it has), then close. Release-before-end preserves the
    // historical order; both run in one synchronous block.
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    sinks.releaseSlot();
    endUi();
    const drained = currentPhase(); // always 'draining' here — endUi just ran or ran earlier
    phase = { kind: 'closed', outcome: drained.kind === 'draining' ? drained.uiCause : { kind: 'completed' } };
  }
}
