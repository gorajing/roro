import { describe, it, expect } from 'vitest';
import { reduceRun, INITIAL_RUN_LIFECYCLE } from './runLifecycle';
import type { ActionEvent } from '../../shared/events';

const started: ActionEvent = { kind: 'run.started', runId: 'run-1', agent: 'codex', ts: 1 };
const completed: ActionEvent = { kind: 'run.completed', runId: 'run-1', ok: true, finalText: 'done', ts: 2 };
const failed: ActionEvent = { kind: 'run.failed', runId: 'run-1', ok: false, error: 'boom', ts: 3 };
const message: ActionEvent = { kind: 'message', runId: 'run-1', text: 'hi', ts: 4 };

describe('runLifecycle', () => {
  it('starts idle, no run, Stop disarmed', () => {
    expect(INITIAL_RUN_LIFECYCLE).toEqual({ status: 'idle', runId: null, stopArmed: false });
  });

  it('run.started → running, captures runId, arms Stop', () => {
    expect(reduceRun(INITIAL_RUN_LIFECYCLE, started)).toEqual({ status: 'running', runId: 'run-1', stopArmed: true });
  });

  it('run.completed → done, clears runId, disarms Stop', () => {
    const running = reduceRun(INITIAL_RUN_LIFECYCLE, started);
    expect(reduceRun(running, completed)).toEqual({ status: 'done', runId: null, stopArmed: false });
  });

  it('run.failed → failed, clears runId, disarms Stop', () => {
    const running = reduceRun(INITIAL_RUN_LIFECYCLE, started);
    expect(reduceRun(running, failed)).toEqual({ status: 'failed', runId: null, stopArmed: false });
  });

  it('non-terminal events (message) are a no-op', () => {
    const running = reduceRun(INITIAL_RUN_LIFECYCLE, started);
    expect(reduceRun(running, message)).toEqual(running);
  });
});
