// src/ambient/trigger.ts — the gated ambient-turn trigger.
//
// Composes the eye + the belief-latch and, WHEN ENABLED (default off), hangs a proactive turn off the
// EXISTING pipeline (the orchestrator's runTurn) — it never forks turnRun, honoring the locked
// "one chokepoint" invariant. Every dependency is injected (gate, capture, describe, runProactiveTurn)
// so it unit-tests with no screen, no model, and no orchestrator. DORMANT: nothing instantiates or
// ticks it today. The ambient eye stays cut-from-v0 and consent-gated until that decision is revisited.

import { observeOnce, type EyeDeps } from './eye';
import { isNewObservation, observationSignature, type AmbientObservation } from './belief';

export interface AmbientTriggerDeps extends EyeDeps {
  /** Master gate. Default OFF — the ambient eye is cut-from-v0 and consent-gated. */
  isEnabled: () => boolean;
  /** Hang a proactive turn off the EXISTING pipeline (e.g. the orchestrator's runTurn). Never a fork. */
  runProactiveTurn: (observation: AmbientObservation) => Promise<void>;
}

export class AmbientTrigger {
  /** Signature of the last observation we acted on — the edge-trigger latch state. */
  private lastSignature: string | null = null;

  constructor(private readonly deps: AmbientTriggerDeps) {}

  /** One ambient tick: gate → observe → restraint → fire. Fires a proactive turn only when enabled
   *  AND the observation is a genuinely NEW event (not a repeat / non-event). The signature is latched
   *  ONLY after the turn succeeds, so a transient failure (model/orchestrator/IPC) is retried on the
   *  next tick rather than silently dropped. Returns whether it fired; a deps rejection propagates
   *  (fail-loud — the caller's loop decides how to handle it). */
  async tick(): Promise<boolean> {
    if (!this.deps.isEnabled()) return false; // gate: off by default — no capture, no model, no turn
    const observation = await observeOnce(this.deps);
    if (!isNewObservation(observation, this.lastSignature)) return false; // restraint: edges only
    await this.deps.runProactiveTurn(observation); // run FIRST; if it rejects we do NOT latch (retry next tick)
    this.lastSignature = observationSignature(observation);
    return true;
  }
}
