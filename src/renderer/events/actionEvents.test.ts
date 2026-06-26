import { describe, it, expect } from 'vitest';
import { activityForEvent } from './actionEvents';
import { SCREEN_CAPTURE_STATUS_TEXT, type ActionEvent } from '../../shared/events';

// The memory recall beat is a `status` event (C1's one union addition), not assistant text.
const status = (text: string): ActionEvent => ({ kind: 'status', runId: 'r', text, ts: 0 });
const msg = (text: string): ActionEvent => ({ kind: 'message', runId: 'r', text, ts: 0 });
const failed = (error: string): ActionEvent => ({ kind: 'run.failed', runId: 'r', ok: false, error, ts: 0 });

describe('activityForEvent — memory beat cue', () => {
  it('fires "recalled memory" when facts or episodes were recalled', () => {
    expect(activityForEvent(status('Memory: 1 known fact, 0 related items'))).toEqual({ kind: 'memory', text: 'recalled memory' });
    expect(activityForEvent(status('Memory: 0 known facts, 3 related items'))).toEqual({ kind: 'memory', text: 'recalled memory' });
    expect(activityForEvent(status('Memory: 12 known facts, 0 related items'))).toEqual({ kind: 'memory', text: 'recalled memory' });
  });
  it('fires "checking memory" when nothing was recalled', () => {
    expect(activityForEvent(status('Memory: 0 known facts, 0 related items'))).toEqual({ kind: 'memory', text: 'checking memory' });
  });
  it('ignores a non-memory status and plain assistant messages', () => {
    expect(activityForEvent(status('some other status'))).toBeNull();
    expect(activityForEvent(msg('qwen2.5:3b (local Ollama) is planning the task…'))).toBeNull();
  });

  it('shows the screen-capture tell as a reading activity cue', () => {
    expect(activityForEvent(status(SCREEN_CAPTURE_STATUS_TEXT))).toEqual({ kind: 'read', text: SCREEN_CAPTURE_STATUS_TEXT });
  });

  it('shows user-stopped terminal events as stopped, not stuck', () => {
    expect(activityForEvent(failed('aborted'))).toEqual({ kind: 'success', text: 'stopped' });
    expect(activityForEvent(failed('spawn codex ENOENT'))).toEqual({ kind: 'error', text: 'stuck' });
  });
});
