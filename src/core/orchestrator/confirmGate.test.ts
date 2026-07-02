import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestConfirm, resolveConfirm } from './confirmGate';

describe('confirmGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pushes a confirm request and resolves true when approved', async () => {
    const pushes: Array<{ runId: string; summary: string }> = [];
    const p = requestConfirm('r1', 'rm -rf build', (req) => pushes.push(req), 15000);
    expect(pushes).toEqual([{ runId: 'r1', summary: 'rm -rf build' }]);
    resolveConfirm('r1', true);
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when explicitly denied', async () => {
    const p = requestConfirm('r2', 's', () => undefined, 15000);
    resolveConfirm('r2', false);
    await expect(p).resolves.toBe(false);
  });

  it('default-DENIES on timeout (a silent room never approves)', async () => {
    const p = requestConfirm('r3', 's', () => undefined, 15000);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toBe(false);
  });

  it('a resolve for an unknown runId is a no-op', () => {
    expect(() => resolveConfirm('nope', true)).not.toThrow();
  });

  it('a late resolve after the timeout is a no-op (no double-resolve)', async () => {
    const p = requestConfirm('r4', 's', () => undefined, 15000);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toBe(false);
    expect(() => resolveConfirm('r4', true)).not.toThrow();
  });
});
