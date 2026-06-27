import { afterEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../shared/ipc';
import { getMemoryHealthStatus, setMemoryHealthStatus } from './memoryHealthStatusStore';
import { warmMemoryHealthAtStartup, type MemoryHealthWindow } from './memoryHealthStartup';

function fakeWindow() {
  const sends: Array<{ channel: string; payload: unknown }> = [];
  const win: MemoryHealthWindow = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      mainFrame: {
        isDestroyed: () => false,
        detached: false,
        send: (channel, payload) => sends.push({ channel, payload }),
      },
    },
  };
  return { win, sends };
}

describe('warmMemoryHealthAtStartup', () => {
  afterEach(() => {
    vi.useRealTimers();
    setMemoryHealthStatus(null);
  });

  it('stores and pushes checking then ok when memory opens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { win, sends } = fakeWindow();
    const profileFacts = vi.fn(async () => []);

    await warmMemoryHealthAtStartup({
      ownerId: 'owner-test',
      win,
      loadMemory: async () => ({ profileFacts }),
      log: { log: vi.fn(), error: vi.fn() },
    });

    expect(profileFacts).toHaveBeenCalledWith('owner-test');
    expect(sends).toEqual([
      { channel: CH.memoryHealthStatus, payload: { state: 'checking', checkedAt: 1000 } },
      { channel: CH.memoryHealthStatus, payload: { state: 'ok', checkedAt: 1000 } },
    ]);
    expect(getMemoryHealthStatus()).toEqual({ state: 'ok', checkedAt: 1000 });
  });

  it('stores and pushes degraded keychain status when memory warmup fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const { win, sends } = fakeWindow();

    await warmMemoryHealthAtStartup({
      ownerId: 'owner-test',
      win,
      loadMemory: async () => {
        throw new Error('memory2: OS keychain unavailable (safeStorage(darwin/os-keychain))');
      },
      log: { log: vi.fn(), error: vi.fn() },
    });

    expect(sends[0]).toEqual({ channel: CH.memoryHealthStatus, payload: { state: 'checking', checkedAt: 2000 } });
    expect(sends[1]).toEqual({
      channel: CH.memoryHealthStatus,
      payload: expect.objectContaining({
        state: 'degraded',
        checkedAt: 2000,
        reason: 'keychain-unavailable',
      }),
    });
    expect(getMemoryHealthStatus()).toEqual(sends[1].payload);
  });
});
