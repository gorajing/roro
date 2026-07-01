import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';

const sent: Array<{ ch: string; payload: { kind?: string; error?: string; runId?: string } }> = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeBrain: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        mainFrame: {
          isDestroyed: () => false,
          detached: false,
          send: (ch: string, payload: { kind?: string; error?: string; runId?: string }) => sent.push({ ch, payload }),
        },
      },
    }],
  },
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

import { cancelTask, runTurn } from './orchestrator';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('condition timed out');
}

describe('orchestrator cancelTask pre-executor preempt', () => {
  let savedAllowCwd: string | undefined;
  let savedCodexBin: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    savedCodexBin = process.env.RORO_CODEX_BIN;
    process.env.RORO_ALLOW_CWD = '1';
    process.env.RORO_CODEX_BIN = process.execPath;
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.describeBrain.mockReturnValue('test brain');
    h.brain.extractFact.mockResolvedValue(null);
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.completed', runId: 'executor-run', ok: true, finalText: 'done', ts: 0 };
    });
  });

  afterEach(() => {
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
    if (savedCodexBin === undefined) delete process.env.RORO_CODEX_BIN;
    else process.env.RORO_CODEX_BIN = savedCodexBin;
  });

  it('no-id Stop during decide marks the latest turn stopped and never dispatches the executor', async () => {
    const decision = deferred<{ narration: string; command: 'run_agent'; args: { task: string } }>();
    h.brain.decide.mockReturnValueOnce(decision.promise);

    const turn = runTurn({ transcript: 'edit a file', sessionId: 's' });
    await waitUntil(() => h.brain.decide.mock.calls.length === 1);

    cancelTask();
    decision.resolve({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file' } });
    const { runId } = await turn;
    await new Promise((r) => setImmediate(r));

    expect(h.run).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ ch: CH.actionEvent, payload: expect.objectContaining({ kind: 'run.failed', runId, error: 'stopped' }) });
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
  });
});
