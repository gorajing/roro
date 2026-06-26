import { describe, expect, it } from 'vitest';
import { eventToAvatarState } from './avatar';
import type { ActionEvent } from './events';

const failed = (error: string): ActionEvent => ({ kind: 'run.failed', runId: 'r', ok: false, error, ts: 0 });

describe('eventToAvatarState', () => {
  it('treats user-stopped terminal events as done, not error', () => {
    expect(eventToAvatarState(failed('stopped'))).toBe('done');
    expect(eventToAvatarState(failed('aborted'))).toBe('done');
    expect(eventToAvatarState(failed('spawn codex ENOENT'))).toBe('error');
  });
});
