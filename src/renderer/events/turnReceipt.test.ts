import { describe, expect, it } from 'vitest';
import type { ActionEvent } from '../../shared/events';
import { initialTurnReceiptState, receiptForTurnEnd, reduceTurnReceipt } from './turnReceipt';

function reduce(events: ActionEvent[]) {
  return events.reduce(reduceTurnReceipt, initialTurnReceiptState());
}

const status = (text: string): ActionEvent => ({ kind: 'status', runId: 'r1', text, ts: 1 });
const completed: ActionEvent = { kind: 'run.completed', runId: 'r1', ok: true, finalText: 'done', ts: 3 };
const failed = (error: string): ActionEvent => ({ kind: 'run.failed', runId: 'r1', ok: false, error, ts: 4 });

describe('turnReceipt', () => {
  it('shows a memory-used receipt when the memory beat recalled saved context', () => {
    const state = reduce([
      status('Memory: 2 known facts, 1 related item'),
      completed,
    ]);

    expect(receiptForTurnEnd(state)).toEqual({ tone: 'success', text: 'Done. Memory used.' });
  });

  it('shows memory checked when no saved memory matched', () => {
    const state = reduce([
      status('Memory: 0 known facts, 0 related items'),
      completed,
    ]);

    expect(receiptForTurnEnd(state)).toEqual({ tone: 'success', text: 'Done. Memory checked.' });
  });

  it('includes the number of changed files without duplicating repeated paths', () => {
    const state = reduce([
      {
        kind: 'file_change',
        runId: 'r1',
        itemId: 'file-1',
        status: 'completed',
        files: [
          { path: 'src/app.ts', op: 'update' },
          { path: 'src/app.ts', op: 'update' },
          { path: 'src/test.ts', op: 'add' },
        ],
        ts: 2,
      },
      status('Memory: 1 known fact, 0 related items'),
      completed,
    ]);

    expect(receiptForTurnEnd(state)).toEqual({ tone: 'success', text: 'Done. Changed 2 files. Memory used.' });
  });

  it('keeps stopped turns neutral', () => {
    const state = reduce([failed('aborted')]);

    expect(receiptForTurnEnd(state)).toEqual({ tone: 'neutral', text: 'Stopped.' });
  });

  it('keeps cancellation neutral even when no terminal failure event was observed', () => {
    const state = reduce([status('Memory: 1 known fact, 0 related items')]);

    expect(receiptForTurnEnd(state, true)).toEqual({ tone: 'neutral', text: 'Stopped.' });
  });

  it('lets a user-requested cancellation win over a noisy terminal failure', () => {
    const state = reduce([failed('spawn codex ENOENT')]);

    expect(receiptForTurnEnd(state, true)).toEqual({ tone: 'neutral', text: 'Stopped.' });
  });

  it('keeps unexpected failures actionable', () => {
    const state = reduce([failed('spawn codex ENOENT')]);

    expect(receiptForTurnEnd(state)).toEqual({
      tone: 'error',
      text: 'Task hit a problem: Codex CLI not found. Install Codex or set RORO_CODEX_BIN to the CLI path, then try again.',
    });
  });
});
