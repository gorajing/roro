import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SAFETY: the coding agent edits files on disk, so a run_agent dispatch with no chosen repo must FAIL LOUD
// (never silently run against cwd — the app bundle / roro's own checkout). Asserts the executor is NOT
// invoked when no repo is set, and IS invoked against the right repo when one is.

const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
  Notification: class { static isSupported() { return false; } show(): void { /* no-op */ } },
}));
vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));

// safeSend now routes pushes through the window registry (never getAllWindows()[0], which the
// pointer overlay would hijack) — point the registry at the same single fake window this file's
// electron mock exposes.
vi.mock('./windowRegistry', async (importOriginal) => {
  const electron = await import('electron');
  return {
    ...(await importOriginal<typeof import('./windowRegistry')>()),
    getPetWindow: () => (electron.BrowserWindow as unknown as { getAllWindows(): unknown[] }).getAllWindows()[0] ?? null,
  };
});

import { runTurn } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('orchestrator: run_agent fails loud when no repo is chosen', () => {
  let savedWorkdir: string | undefined;
  let savedAllowCwd: string | undefined;
  let savedCodexBin: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    savedWorkdir = process.env.RORO_WORKDIR;
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    savedCodexBin = process.env.RORO_CODEX_BIN;
    process.env.RORO_CODEX_BIN = process.execPath;
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.extractFact.mockResolvedValue(null);
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file' } });
    h.run.mockImplementation(async function* () { yield { kind: 'run.completed', runId: 'r', ok: true, finalText: 'done', ts: 0 }; });
  });
  afterEach(() => {
    const restore = (k: string, v: string | undefined): void => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore('RORO_WORKDIR', savedWorkdir);
    restore('RORO_ALLOW_CWD', savedAllowCwd);
    restore('RORO_CODEX_BIN', savedCodexBin);
  });

  it('does NOT dispatch the executor when no repo is set (never touches cwd)', async () => {
    delete process.env.RORO_WORKDIR;
    delete process.env.RORO_ALLOW_CWD;
    const { runId } = await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();
    expect(runId).toBeTruthy(); // fail-loud is terminal, not a crash/hang
    expect(h.run).not.toHaveBeenCalled(); // the agent was NOT run against an unchosen directory
  });

  it('dispatches against RORO_WORKDIR when a repo is chosen', async () => {
    process.env.RORO_WORKDIR = '/chosen/repo';
    delete process.env.RORO_ALLOW_CWD;
    await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ repo: '/chosen/repo' }));
  });

  it('dispatches against cwd ONLY with the explicit RORO_ALLOW_CWD dev opt-in', async () => {
    delete process.env.RORO_WORKDIR;
    process.env.RORO_ALLOW_CWD = '1';
    await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ repo: process.cwd() }));
  });
});
