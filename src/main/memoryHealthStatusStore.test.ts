import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getMemoryHealthStatus,
  memoryHealthChecking,
  memoryHealthFailureFromError,
  memoryHealthOk,
  setMemoryHealthStatus,
} from './memoryHealthStatusStore';

describe('memoryHealthStatusStore', () => {
  afterEach(() => {
    vi.useRealTimers();
    setMemoryHealthStatus(null);
  });

  it('stores the latest memory-health snapshot', () => {
    const status = memoryHealthChecking(123);
    setMemoryHealthStatus(status);
    expect(getMemoryHealthStatus()).toEqual({ state: 'checking', checkedAt: 123 });
    setMemoryHealthStatus(null);
    expect(getMemoryHealthStatus()).toBeNull();
  });

  it('reports an ok snapshot with a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(456);
    expect(memoryHealthOk()).toEqual({ state: 'ok', checkedAt: 456 });
  });

  it('classifies unavailable keychain failures without suggesting plaintext fallback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(789);
    const status = memoryHealthFailureFromError(
      new Error('memory2: OS keychain unavailable (safeStorage(darwin/os-keychain))'),
    );

    expect(status).toEqual({
      state: 'degraded',
      checkedAt: 789,
      reason: 'keychain-unavailable',
      message: expect.stringContaining('Roro cannot reach the OS keychain'),
    });
    expect(status.message).not.toMatch(/plaintext|reset/i);
  });

  it('classifies locked encrypted-memory failures separately', () => {
    const status = memoryHealthFailureFromError(new Error('memory2: the memory store is locked — its data key is unrecoverable'));
    expect(status.reason).toBe('memory-locked');
    expect(status.message).toMatch(/memory is locked/i);
  });
});
