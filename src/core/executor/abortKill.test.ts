import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { armSigkillEscalation, type KillableChild } from './abortKill';

function fakeChild() {
  const killed: NodeJS.Signals[] = [];
  let exitCb: (() => void) | null = null;
  const child: KillableChild & { exitCode: number | null } = {
    exitCode: null,
    kill: (s: NodeJS.Signals) => { killed.push(s); return true; },
    once: (_e: 'exit', cb: () => void) => { exitCb = cb; },
  };
  return { child, killed, exit: (code: number) => { child.exitCode = code; exitCb?.(); } };
}

describe('armSigkillEscalation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('SIGKILLs a child that ignores SIGTERM after the grace period', () => {
    const h = fakeChild();
    const ac = new AbortController();
    armSigkillEscalation(h.child, ac.signal, 1000);
    ac.abort();
    vi.advanceTimersByTime(1000);
    expect(h.killed).toEqual(['SIGKILL']);
  });

  it('does NOT SIGKILL a child that already exited (SIGTERM worked)', () => {
    const h = fakeChild();
    const ac = new AbortController();
    armSigkillEscalation(h.child, ac.signal, 1000);
    ac.abort();
    h.exit(0); // child exited before the grace elapsed
    vi.advanceTimersByTime(1000);
    expect(h.killed).toEqual([]);
  });

  it('does nothing without an abort', () => {
    const h = fakeChild();
    const ac = new AbortController();
    armSigkillEscalation(h.child, ac.signal, 1000);
    vi.advanceTimersByTime(5000);
    expect(h.killed).toEqual([]);
  });

  it('handles an already-aborted signal (escalates immediately on grace)', () => {
    const h = fakeChild();
    const ac = new AbortController();
    ac.abort();
    armSigkillEscalation(h.child, ac.signal, 1000);
    vi.advanceTimersByTime(1000);
    expect(h.killed).toEqual(['SIGKILL']);
  });

  it('is a no-op when there is no signal', () => {
    const h = fakeChild();
    armSigkillEscalation(h.child, undefined, 1000);
    vi.advanceTimersByTime(1000);
    expect(h.killed).toEqual([]);
  });
});
