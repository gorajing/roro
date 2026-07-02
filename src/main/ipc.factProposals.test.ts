import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The consent-to-storage boundary of the executor-facts pilot: CH.factProposalResolve is the ONLY
// path from an unconfirmed proposal to a durable fact. These tests pin registration gating, the
// provenance write, single-corroboration semantics, retry-on-failure, and the double-resolve race.

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  memory: {
    getProfile: vi.fn(async () => []),
    replaceFact: vi.fn(),
    reinforceFact: vi.fn(async () => null),
    traceExtraction: vi.fn(),
    profileFacts: vi.fn(async () => []),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown): void => { h.handlers.set(channel, fn); } },
  shell: { openExternal: vi.fn() },
}));
vi.mock('./orchestrator', () => ({
  runTurn: vi.fn(), runTask: vi.fn(), cancelTask: vi.fn(), resolveDestructiveConfirm: vi.fn(),
}));
vi.mock('./siblings', () => ({ loadBrain: vi.fn(), loadMemory: async () => h.memory, loadVision: vi.fn() }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../brain/ollama', () => ({ pullModel: vi.fn() }));
vi.mock('./bootstrapRefresh', () => ({ refreshBootstrapStatus: vi.fn() }));
vi.mock('./safeSend', () => ({ sendToWebContents: vi.fn(), sendToPetWindow: vi.fn() }));

import { CH } from '../shared/ipc';
import { registerIpcHandlers } from './ipc';
import { pendingProposals } from './factProposals/runner';

const PROPOSAL = { sessionId: 's1', agent: 'codex' as const, key: 'tests_location', value: 'keeps tests beside features', evidence: 'keeps tests beside features' };

function register(flag: boolean): void {
  h.handlers.clear();
  if (flag) process.env.RORO_EXECUTOR_FACTS = '1';
  else delete process.env.RORO_EXECUTOR_FACTS;
  registerIpcHandlers();
}
const resolve = (input: unknown): Promise<{ ok: boolean; gone?: boolean }> =>
  h.handlers.get(CH.factProposalResolve)!(undefined, input) as Promise<{ ok: boolean; gone?: boolean }>;

describe('CH.factProposalResolve — the consent-to-storage boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingProposals.clear();
    h.memory.getProfile.mockResolvedValue([]); // no active row for the key -> storeFact goes 'stored'
    h.memory.replaceFact.mockImplementation(async (input: Record<string, unknown>) => ({ id: 'row1', ...input }));
  });
  afterEach(() => {
    delete process.env.RORO_EXECUTOR_FACTS;
    pendingProposals.clear();
  });

  it('handlers are UNREGISTERED when the flag is off — registration is the boundary', () => {
    register(false);
    expect(h.handlers.has(CH.factProposalsGet)).toBe(false);
    expect(h.handlers.has(CH.factProposalResolve)).toBe(false);
  });

  it('accept stores the fact THROUGH the shared lifecycle with executor provenance, then reinforces once', async () => {
    register(true);
    const [p] = pendingProposals.add([PROPOSAL]);
    const out = await resolve({ id: p.id, accept: true });
    expect(out).toEqual({ ok: true });
    const written = h.memory.replaceFact.mock.calls[0][0] as { payload: { source: Record<string, unknown> } };
    expect(written.payload.source).toMatchObject({ channel: 'executor', claimed_by: 'codex', evidence: PROPOSAL.evidence });
    expect(h.memory.reinforceFact).toHaveBeenCalledTimes(1); // the click = ONE corroboration
    expect(pendingProposals.list()).toEqual([]); // left the queue only after the successful store
  });

  it('a FAILING store keeps the proposal queued for retry (peek-don\'t-take)', async () => {
    register(true);
    const [p] = pendingProposals.add([PROPOSAL]);
    h.memory.replaceFact.mockRejectedValue(new Error('db down'));
    await expect(resolve({ id: p.id, accept: true })).rejects.toThrow('db down');
    expect(pendingProposals.list()).toHaveLength(1); // still there — the panel can retry
  });

  it('DOUBLE-RESOLVE RACE: two concurrent accepts for one id store and corroborate exactly ONCE', async () => {
    register(true);
    const [p] = pendingProposals.add([PROPOSAL]);
    let release!: (v: unknown) => void;
    h.memory.replaceFact.mockImplementation((input: Record<string, unknown>) =>
      new Promise((res) => { release = () => res({ id: 'row1', ...input }); }));
    const first = resolve({ id: p.id, accept: true });
    await new Promise((r) => setTimeout(r, 20)); // let the first pass the guard and reach the store
    const second = await resolve({ id: p.id, accept: true }); // races while the first store is in flight
    expect(second).toEqual({ ok: true, gone: true });
    release(undefined);
    await first;
    expect(h.memory.replaceFact).toHaveBeenCalledTimes(1);
    expect(h.memory.reinforceFact).toHaveBeenCalledTimes(1);
  });

  it('reject removes the proposal without touching memory', async () => {
    register(true);
    const [p] = pendingProposals.add([PROPOSAL]);
    const out = await resolve({ id: p.id, accept: false });
    expect(out).toEqual({ ok: true, gone: false });
    expect(h.memory.replaceFact).not.toHaveBeenCalled();
    expect(pendingProposals.list()).toEqual([]);
  });

  it('an unknown/expired id is a typed gone no-op', async () => {
    register(true);
    expect(await resolve({ id: 'nope', accept: true })).toEqual({ ok: true, gone: true });
  });

  it('malformed input throws (fail loud, never a silent partial resolve)', async () => {
    register(true);
    await expect(resolve({ id: 42, accept: 'yes' })).rejects.toThrow('expected { id: string, accept: boolean }');
  });
});
