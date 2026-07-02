import { describe, expect, it } from 'vitest';
import { isActivityEvent, silentRunWarning } from './formatDrift';

describe('formatDrift — silent-empty-run tripwire', () => {
  it('warns when a run COMPLETES with zero mapped activity (the drift signature)', () => {
    expect(silentRunWarning(0, 'run.completed')).toMatch(/format drift/);
  });

  it('stays quiet for a completed run with any mapped activity', () => {
    expect(silentRunWarning(3, 'run.completed')).toBeNull();
  });

  it('stays quiet for a FAILED run — failure already surfaces loudly on its own', () => {
    expect(silentRunWarning(0, 'run.failed')).toBeNull();
  });

  it('classifies activity vs lifecycle kinds', () => {
    expect(isActivityEvent('command')).toBe(true);
    expect(isActivityEvent('file_change')).toBe(true);
    expect(isActivityEvent('run.completed')).toBe(false);
    expect(isActivityEvent('turn.started')).toBe(false);
  });
});
