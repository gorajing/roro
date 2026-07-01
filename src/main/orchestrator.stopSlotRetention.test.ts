import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';

type Sent = { ch: string; payload: { kind?: string; text?: string; error?: string; runId?: string } };

const sent: Sent[] = [];
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
          send: (ch: string, payload: Sent['payload']) => sent.push({ ch, payload }),
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

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('orchestrator Stop slot retention', () => {
  let savedAllowCwd: string | undefined;
  let savedCodexBin: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file' } });
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.started', runId: 'executor-run', agent: 'codex', ts: 0 };
      yield { kind: 'run.completed', runId: 'executor-run', ok: true, finalText: 'done', ts: 0 };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
    if (savedCodexBin === undefined) delete process.env.RORO_CODEX_BIN;
    else process.env.RORO_CODEX_BIN = savedCodexBin;
  });

  it('keeps the single-executor slot occupied after Stop until the aborted stream truly ends', async () => {
    const firstStarted = deferred();
    const firstAborted = deferred();
    const drainFirst = deferred();
    const firstStreamDone = deferred();

    h.run.mockImplementationOnce(async function* (opts: { signal?: AbortSignal }) {
      if (opts.signal?.aborted) firstAborted.resolve();
      else opts.signal?.addEventListener('abort', () => firstAborted.resolve(), { once: true });

      firstStarted.resolve();
      yield { kind: 'run.started', runId: 'executor-run-1', agent: 'codex', ts: 0 };
      await firstAborted.promise;
      await drainFirst.promise;
      yield { kind: 'run.completed', runId: 'executor-run-1', ok: true, finalText: 'late success', ts: 0 };
      firstStreamDone.resolve();
    });

    try {
      const first = await runTurn({ transcript: 'first edit', sessionId: 's' });
      await firstStarted.promise;

      cancelTask(first.runId);
      await firstAborted.promise;
      await vi.advanceTimersByTimeAsync(1501);
      await flush();

      expect(sent).toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({ kind: 'run.failed', runId: first.runId, error: 'stopped' }),
      });
      expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId: first.runId } });

      const second = await runTurn({ transcript: 'second edit', sessionId: 's' });
      await flush();

      expect(h.run).toHaveBeenCalledTimes(1);
      expect(sent).toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({
          kind: 'message',
          runId: second.runId,
          text: "I'm already working on something — Stop that first, or wait for it to finish.",
        }),
      });
      expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId: second.runId } });

      drainFirst.resolve();
      await firstStreamDone.promise;
      await flush();

      expect(sent).not.toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({ kind: 'run.completed', runId: first.runId }),
      });

      const third = await runTurn({ transcript: 'third edit', sessionId: 's' });
      await flush();

      expect(h.run).toHaveBeenCalledTimes(2);
      expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId: third.runId } });
    } finally {
      drainFirst.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await flush();
    }
  });
});
