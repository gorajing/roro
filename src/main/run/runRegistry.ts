// src/main/run/runRegistry.ts — the registry of live Turns + the single-executor SLOT
// (docs/plans/run-state-machine.md).
//
// Replaces five orchestrator module mutables 1:1:
//   inFlightTurns  -> #turns (mint to end; bounds requestStop against stale/garbage ids)
//   preemptedTurns -> Turn phase 'stopping' (preemption is a PHASE, not set membership)
//   lastTurnId     -> #lastTurnId (the no-id Stop fallback)
//   dispatchLock   -> the DispatchSection (the TOCTOU lock as a type)
//   activeRuns     -> #slot (occupancy = a committed pump; freed only when its stream drains)

import { CH } from '../../shared/ipc';
import { resolveConfirm } from '../confirmGate';
import { sendToPetWindow } from '../safeSend';
import { Turn } from './turnState';

export interface RunRegistryDeps {
  /** Push CH.runEnd for a turn — fired exactly once per turn, from Turn.end(). */
  pushRunEnd: (runId: string) => void;
  /** Deny a pending destructive confirm (resolveConfirm(runId, false)). */
  denyConfirm: (runId: string) => void;
}

/** What requestStop did — a total function over any phase and any id. */
export type StopOutcome = 'stopping' | 'aborted-pump' | 'ignored';

/**
 * The clean-tree-check → dispatch critical section as a TYPE. Only one may be open, and only
 * while the slot is free; it stays open across the awaited isCleanTree check, so no other turn
 * can start an executor in between — the clean-tree result is fresh at dispatch (no TOCTOU).
 * commit() is SYNCHRONOUS and is the ONLY way to occupy the slot: it registers the pump AND
 * closes the section atomically.
 */
export interface DispatchSection {
  commit(controller: AbortController): void;
  /** Close without dispatching (refused / stopped inside the section). Idempotent. */
  close(): void;
}

export class RunRegistry {
  readonly #deps: RunRegistryDeps;
  readonly #turns = new Map<string, Turn>();
  #lastTurnId: string | null = null;
  #sectionOpen = false;
  #slot: { runId: string; controller: AbortController } | null = null;

  constructor(deps: RunRegistryDeps) {
    this.#deps = deps;
  }

  /** Mint the Turn for a new runId (phase 'minted') and make it the no-id Stop fallback target. */
  mint(runId: string): Turn {
    const turn = new Turn(runId, (t) => {
      this.#turns.delete(t.runId);
      this.#deps.pushRunEnd(t.runId);
    });
    this.#turns.set(runId, turn);
    this.#lastTurnId = runId;
    return turn;
  }

  get(runId: string): Turn | undefined {
    return this.#turns.get(runId);
  }

  /** The most recently minted turn/task runId — the no-id Stop fallback, which must also reach
   *  a turn still in decide/confirm (when no pump is registered yet). */
  get lastTurnId(): string | null {
    return this.#lastTurnId;
  }

  /** The runId holding the single-executor slot (possibly UI-ended already and draining). */
  slotHolder(): string | null {
    return this.#slot?.runId ?? null;
  }

  /**
   * Stop / preempt — total over any phase and any id:
   *  - pre-dispatch phases -> 'stopping' (consumed by the next stopCheckpoint), then deny any
   *    pending destructive confirm (the confirm-deny message deliberately wins over 'stopped'
   *    when a Stop races the confirm);
   *  - running -> abort the pump's controller instead (arming the Stop watchdog); the confirm
   *    deny still fires so a Stop can never leave a chip pending;
   *  - ended / draining / unknown ids -> 'ignored' (bounds against stale/garbage ids from the
   *    public cancelTask IPC — ended turns leave the map).
   */
  requestStop(runId: string): StopOutcome {
    const turn = this.#turns.get(runId);
    if (!turn) return 'ignored';
    if (turn.phase.kind === 'running') {
      this.#deps.denyConfirm(runId);
      if (this.#slot?.runId === runId) this.#slot.controller.abort();
      return 'aborted-pump';
    }
    turn.to({ kind: 'stopping' }); // sticky no-op when already stopping
    this.#deps.denyConfirm(runId);
    return 'stopping';
  }

  /** Abort the slot's pump if `runId` holds it (the no-id Stop's "also abort the latest run",
   *  which must reach a DRAINING run whose turn already ended). */
  abortPump(runId: string): void {
    if (this.#slot?.runId === runId) this.#slot.controller.abort();
  }

  /**
   * Open the dispatch critical section for `turn`, or null when a section is already open OR
   * the slot is occupied — the busy refusal (non-queuing: the caller refuses, never waits).
   */
  tryBeginDispatch(turn: Turn): DispatchSection | null {
    if (this.#sectionOpen || this.#slot) return null;
    this.#sectionOpen = true;
    let open = true;
    const close = (): void => {
      if (!open) return;
      open = false;
      this.#sectionOpen = false;
    };
    return {
      commit: (controller: AbortController): void => {
        if (!open) throw new Error(`[registry] commit on a closed dispatch section (${turn.runId})`);
        this.#slot = { runId: turn.runId, controller };
        turn.to({ kind: 'running' });
        close();
      },
      close,
    };
  }

  /** Free the single-executor slot — ONLY once the run's stream has truly drained. */
  releasePump(runId: string): void {
    if (this.#slot?.runId === runId) this.#slot = null;
  }

  /** Abort + free the slot immediately (the app-quit path — no drain wait by design). */
  cancelAll(): void {
    if (this.#slot) {
      this.#slot.controller.abort();
      this.#slot = null;
    }
  }
}

function createDefaultRegistry(): RunRegistry {
  return new RunRegistry({
    pushRunEnd: (runId) => {
      sendToPetWindow(CH.runEnd, { runId });
    },
    denyConfirm: (runId) => {
      resolveConfirm(runId, false);
    },
  });
}

let registry = createDefaultRegistry();

/** The module singleton the orchestrator facade drives. */
export function getRunRegistry(): RunRegistry {
  return registry;
}

/** Test-only: rebuild the singleton (for suites that need a pristine registry between tests). */
export const __test = {
  reset(): void {
    registry = createDefaultRegistry();
  },
};
