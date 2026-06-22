// src/renderer/events/runLifecycle.ts — derive a small run-state from the ActionEvent stream.
//
// Since `turnRun` now resolves at DISPATCH (not at completion), the renderer can no longer learn
// "the run finished" from the invoke promise — it must read the push stream. This pure reducer maps
// run.started/completed/failed into {status, runId, stopArmed}; the floating Stop pill and the busy
// pose read it. (runState.ts keeps its tiny boolean for the voice/avatar back-compat consumers.)
import type { ActionEvent } from '../../shared/events';

export type RunStatus = 'idle' | 'running' | 'done' | 'failed';

export interface RunLifecycle {
  status: RunStatus;
  /** The active run's id (from run.started) while running; null otherwise. Used by cancelTask(id). */
  runId: string | null;
  stopArmed: boolean;
}

export const INITIAL_RUN_LIFECYCLE: RunLifecycle = { status: 'idle', runId: null, stopArmed: false };

export function reduceRun(state: RunLifecycle, e: ActionEvent): RunLifecycle {
  switch (e.kind) {
    case 'run.started':
      return { status: 'running', runId: e.runId, stopArmed: true };
    case 'run.completed':
      return { status: 'done', runId: null, stopArmed: false };
    case 'run.failed':
      return { status: 'failed', runId: null, stopArmed: false };
    default:
      return state;
  }
}
