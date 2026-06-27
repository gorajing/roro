import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryModule } from './siblings';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn(),
  openExternal: vi.fn(),
  loadBrain: vi.fn(),
  loadMemory: vi.fn(),
  loadVision: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: h.getPath },
  BrowserWindow: { fromWebContents: h.fromWebContents },
  dialog: { showOpenDialog: h.showOpenDialog },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown): void => { h.handlers.set(channel, fn); } },
  shell: { openExternal: h.openExternal },
}));

vi.mock('./mic', () => ({
  getMicStatus: () => 'unknown',
  ensureMicAccess: async () => 'unknown',
}));
vi.mock('./orchestrator', () => ({
  runTurn: vi.fn(),
  runTask: vi.fn(),
  cancelTask: vi.fn(),
  resolveDestructiveConfirm: vi.fn(),
}));
vi.mock('./siblings', () => ({
  loadBrain: h.loadBrain,
  loadMemory: h.loadMemory,
  loadVision: h.loadVision,
}));
vi.mock('./identity', () => ({
  getOwnerId: () => 'owner-test',
}));
vi.mock('../brain/ollama', () => ({
  ollamaTags: vi.fn(),
  pullModel: vi.fn(),
}));

import { CH } from '../shared/ipc';
import { registerIpcHandlers } from './ipc';
import { setMemoryHealthStatus } from './memoryHealthStatusStore';

function handler<T extends (...args: never[]) => unknown>(channel: string): T {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`missing handler for ${channel}`);
  return fn as T;
}

function fakeMemory(): MemoryModule {
  return {
    remember: vi.fn(),
    replaceFact: vi.fn(),
    reinforceFact: vi.fn(),
    recall: vi.fn(),
    getProfile: vi.fn(),
    profileFacts: vi.fn().mockResolvedValue([
      {
        id: 'fact-1',
        key: 'editor',
        value: 'prefers vim',
        text: 'prefers vim',
        created_at: '2026-06-21T00:00:00Z',
      },
    ]),
    fixFact: vi.fn().mockResolvedValue({
      id: 'fact-2',
      key: 'editor',
      value: 'prefers zed',
      text: 'prefers zed',
      created_at: '2026-06-22T00:00:00Z',
    }),
    verifyFact: vi.fn().mockResolvedValue({
      id: 'fact-1',
      key: 'editor',
      value: 'prefers vim',
      text: 'prefers vim',
      created_at: '2026-06-21T00:00:00Z',
    }),
    factSource: vi.fn().mockResolvedValue({
      id: 'fact-1',
      source: { session_id: 's1', turn_ts: 1718900000000 },
    }),
    supersede: vi.fn(),
    forgetFact: vi.fn(),
    traceExtraction: vi.fn(),
  };
}

describe('memory IPC trust loop', () => {
  let memory: MemoryModule;
  let savedDebugBridge: string | undefined;

  beforeEach(() => {
    savedDebugBridge = process.env.RORO_DEBUG_BRIDGE;
    h.handlers.clear();
    h.loadBrain.mockReset();
    h.loadMemory.mockReset();
    h.loadVision.mockReset();
    memory = fakeMemory();
    h.loadMemory.mockResolvedValue(memory);
    registerIpcHandlers();
  });

  afterEach(() => {
    if (savedDebugBridge === undefined) delete process.env.RORO_DEBUG_BRIDGE;
    else process.env.RORO_DEBUG_BRIDGE = savedDebugBridge;
    setMemoryHealthStatus(null);
  });

  it('memory:profile injects the MAIN owner and returns the renderer-safe view', async () => {
    const result = await handler<() => Promise<unknown>>(CH.memoryProfile)();

    expect(memory.profileFacts).toHaveBeenCalledWith('owner-test');
    expect(result).toEqual([
      {
        id: 'fact-1',
        key: 'editor',
        value: 'prefers vim',
        text: 'prefers vim',
        created_at: '2026-06-21T00:00:00Z',
      },
    ]);
  });

  it('memory:fixFact ignores renderer-supplied owner/key fields', async () => {
    const result = await handler<(event: unknown, input: unknown) => Promise<unknown>>(CH.memoryFixFact)(
      {},
      { id: 'fact-1', value: 'prefers zed', owner_id: 'evil-owner', key: 'evil-key' },
    );

    expect(memory.fixFact).toHaveBeenCalledWith('owner-test', 'fact-1', 'prefers zed');
    expect(result).toMatchObject({ key: 'editor', value: 'prefers zed' });
  });

  it('memory:verifyFact and memory:factSource inject the MAIN owner', async () => {
    await handler<(event: unknown, id: string) => Promise<unknown>>(CH.memoryVerifyFact)({}, 'fact-1');
    await handler<(event: unknown, id: string) => Promise<unknown>>(CH.memoryFactSource)({}, 'fact-1');

    expect(memory.verifyFact).toHaveBeenCalledWith('owner-test', 'fact-1');
    expect(memory.factSource).toHaveBeenCalledWith('owner-test', 'fact-1');
  });

  it('memory:fixFact propagates stale-id failures without falling back to another mutation', async () => {
    vi.mocked(memory.fixFact).mockRejectedValueOnce(new Error('Fact is no longer available. Reopen Memory and try again.'));

    await expect(
      handler<(event: unknown, input: unknown) => Promise<unknown>>(CH.memoryFixFact)(
        {},
        { id: 'stale', value: 'prefers zed' },
      ),
    ).rejects.toThrow(/no longer available/i);

    expect(memory.replaceFact).not.toHaveBeenCalled();
    expect(memory.forgetFact).not.toHaveBeenCalled();
  });

  it('memory:forget remains owner-scoped through MAIN', async () => {
    await handler<(event: unknown, id: string) => Promise<void>>(CH.memoryForget)({}, 'fact-1');

    expect(memory.forgetFact).toHaveBeenCalledWith('owner-test', 'fact-1');
  });

  it('memory health status is fetchable outside the debug bridge', async () => {
    const status = {
      state: 'degraded' as const,
      checkedAt: 123,
      reason: 'keychain-unavailable' as const,
      message: 'Local memory is paused.',
    };
    setMemoryHealthStatus(status);

    expect(h.handlers.has(CH.memoryHealthStatusGet)).toBe(true);
    expect(h.handlers.has(CH.memoryRecall)).toBe(false);
    expect(await handler<() => unknown>(CH.memoryHealthStatusGet)()).toEqual(status);
  });

  it('memory:remember still rejects renderer-authored facts before loading memory', async () => {
    h.handlers.clear();
    process.env.RORO_DEBUG_BRIDGE = '1';
    registerIpcHandlers();

    await expect(
      handler<(event: unknown, input: unknown) => Promise<unknown>>(CH.memoryRemember)(
        {},
        { session_id: 's1', kind: 'fact', text: 'sneaky fact' },
      ),
    ).rejects.toThrow(/cannot write kind:'fact'/i);

    expect(h.loadMemory).not.toHaveBeenCalled();
  });
});
