// src/main/run/turnState.ts — the per-turn TURN machine (docs/plans/run-state-machine.md).
//
// A Turn tracks ONE turn (voice turn or direct task) from mint to runEnd. Its phase is UI truth:
// "ended" means runEnd has been pushed. Process truth (has the executor child's stream drained?)
// belongs to the pump/slot, owned by the RunRegistry — a watchdog Stop ENDS the turn at 1.5s
// while the slot stays held until the aborted stream drains.

/** Why a turn ended. `failed.error` / `refused.reason` carry the terminal string. */
export type EndCause =
  | { kind: 'completed' }
  | { kind: 'failed'; error: string }
  | { kind: 'stopped' }
  | { kind: 'refused'; reason: string };

/**
 * minted → deciding{1} → (capturing → deciding{2})? → gating → confirming → dispatching →
 * running → ended{cause}; runTask skips deciding (minted → gating). `stopping` is preemption
 * AS a phase: any pre-dispatch phase can enter it, and explicit stopCheckpoints consume it
 * into ended{stopped}. `running` never becomes `stopping` — a Stop there aborts the pump's
 * controller instead (arming the Stop watchdog).
 */
export type TurnPhase =
  | { kind: 'minted' }
  | { kind: 'deciding'; pass: 1 | 2 }
  | { kind: 'capturing' }
  | { kind: 'gating' }
  | { kind: 'confirming' }
  | { kind: 'dispatching' }
  | { kind: 'running' }
  | { kind: 'stopping' }
  | { kind: 'ended'; cause: EndCause };

type LivePhase = Exclude<TurnPhase, { kind: 'ended' }>;

/** The REAL forward edges (the spec's rule: model real edges first, fail loud on the rest). */
function isLegalEdge(from: TurnPhase, next: LivePhase): boolean {
  if (next.kind === 'stopping') {
    // Preemption can land in any pre-dispatch phase, and in `dispatching` (whose in-section
    // stopCheckpoint consumes it). It never lands in `running` — requestStop aborts instead.
    return from.kind !== 'running';
  }
  switch (from.kind) {
    case 'minted':
      return (next.kind === 'deciding' && next.pass === 1) || next.kind === 'gating';
    case 'deciding':
      return from.pass === 1
        ? next.kind === 'capturing' || next.kind === 'gating'
        : next.kind === 'gating';
    case 'capturing':
      return next.kind === 'deciding' && next.pass === 2;
    case 'gating':
      return next.kind === 'confirming';
    case 'confirming':
      return next.kind === 'dispatching';
    case 'dispatching':
      return next.kind === 'running';
    case 'running':
    case 'stopping': // unreachable: to() short-circuits sticky stopping before the edge check
    case 'ended':
      return false;
  }
}

export class Turn {
  readonly runId: string;
  #phase: TurnPhase = { kind: 'minted' };
  readonly #onEnded: (turn: Turn) => void;

  constructor(runId: string, onEnded: (turn: Turn) => void) {
    this.runId = runId;
    this.#onEnded = onEnded;
  }

  get phase(): TurnPhase {
    return this.#phase;
  }

  /** True while a Stop is pending — every preemptedTurns.has() site became this check. */
  get stopRequested(): boolean {
    return this.#phase.kind === 'stopping';
  }

  get ended(): boolean {
    return this.#phase.kind === 'ended';
  }

  /**
   * Move the machine forward. THROWS on an illegal edge (fail loud) with two carve-outs that
   * model reality: (1) `stopping` is sticky — work already in flight (a decide/vision await)
   * keeps making progress calls, which no-op until a stopCheckpoint consumes the stop into
   * ended{stopped}; (2) ending is `end()`'s job, never `to()`'s.
   */
  to(next: LivePhase): void {
    if (this.#phase.kind === 'ended') {
      throw new Error(`[turn ${this.runId}] illegal transition: ended → ${next.kind}`);
    }
    if (this.#phase.kind === 'stopping') return; // sticky until a stopCheckpoint consumes it
    if (!isLegalEdge(this.#phase, next)) {
      throw new Error(`[turn ${this.runId}] illegal transition: ${this.#phase.kind} → ${next.kind}`);
    }
    this.#phase = next;
  }

  /**
   * End the turn — idempotent-BY-RETURN (a second end is a tolerated no-op, e.g. the executor
   * finally's endUi after a watchdog already ended the UI), and legal from ANY live phase
   * (a decide-throw ends straight out of deciding). Via onEnded this is the ONLY path that
   * pushes runEnd.
   */
  end(cause: EndCause): boolean {
    if (this.#phase.kind === 'ended') return false;
    this.#phase = { kind: 'ended', cause };
    this.#onEnded(this);
    return true;
  }
}
