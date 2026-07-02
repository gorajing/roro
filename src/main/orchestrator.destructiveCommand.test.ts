import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';
import { resolveConfirm } from './confirmGate';

type Sent = { ch: string; payload: { kind?: string; text?: string; error?: string; runId?: string; command?: string } };

const sent: Sent[] = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeBrain: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
  isCleanTree: vi.fn(),
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('./gitTree', () => ({ isCleanTree: h.isCleanTree }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));

import { installTestPorts, resetTestPorts } from '../core/ports/testing';
import { runTurn } from './orchestrator';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('condition timed out');
}

function runEndsFor(runId: string): Sent[] {
  return sent.filter((item) => item.ch === CH.runEnd && item.payload.runId === runId);
}

function actionEventsFor(runId: string): Sent[] {
  return sent.filter((item) => item.ch === CH.actionEvent && item.payload.runId === runId);
}

describe('orchestrator destructive command tripwire', () => {
  let savedAllowCwd: string | undefined;
  let savedCodexBin: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    installTestPorts({ rendererPush: { send: (ch, ...args) => { sent.push({ ch, payload: args[0] as Sent['payload'] }); return true; } } });
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    savedCodexBin = process.env.RORO_CODEX_BIN;
    process.env.RORO_ALLOW_CWD = '1';
    process.env.RORO_CODEX_BIN = process.execPath;
    h.isCleanTree.mockResolvedValue(true);
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.describeBrain.mockReturnValue('test brain');
    h.brain.extractFact.mockResolvedValue(null);
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'inspect files' } });
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.started', runId: 'executor-run', agent: 'codex', ts: 0 };
      yield { kind: 'command', runId: 'executor-run', itemId: 'cmd', status: 'started', command: 'npm test', ts: 0 };
      yield { kind: 'run.completed', runId: 'executor-run', ok: true, finalText: 'done', ts: 0 };
    });
  });

  afterEach(() => {
    resetTestPorts();
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
    if (savedCodexBin === undefined) delete process.env.RORO_CODEX_BIN;
    else process.env.RORO_CODEX_BIN = savedCodexBin;
  });

  it('injects a DestructiveGate into executor.run for every coding run (the SDK gate seam; CLI adapters ignore it)', async () => {
    const first = await runTurn({ transcript: 'inspect files', sessionId: 's' });
    await waitUntil(() => runEndsFor(first.runId).length === 1);
    expect(h.run).toHaveBeenCalledTimes(1);
    const opts = h.run.mock.calls[0][0] as { gate?: { classify: unknown; ask: unknown; onCleared: unknown; preApprovedReason?: unknown }; signal?: AbortSignal };
    expect(opts.gate).toBeDefined();
    expect(typeof opts.gate?.classify).toBe('function');
    expect(typeof opts.gate?.ask).toBe('function');
    expect(typeof opts.gate?.onCleared).toBe('function');
    // The task ('inspect files') is non-destructive → nothing pre-approved.
    expect(opts.gate?.preApprovedReason).toBeUndefined();
    // classify is bound to the repo — a destructive command classifies positive.
    const verdict = (opts.gate as { classify: (c: string) => { destructive: boolean } }).classify('rm -rf build');
    expect(verdict.destructive).toBe(true);
  });

  it('threads the pre-dispatch approval reason into the gate as preApprovedReason', async () => {
    h.brain.decide.mockResolvedValueOnce({
      narration: 'on it',
      command: 'run_agent',
      args: { task: 'Remove the generated build directory with rm -rf build.' },
    });
    const turn = runTurn({ transcript: 'remove build', sessionId: 's' });
    await waitUntil(() => sent.some((item) => item.ch === CH.confirmRequest));
    const runId = sent.find((item) => item.ch === CH.confirmRequest)?.payload.runId;
    if (!runId) throw new Error('confirm request missing runId');
    resolveConfirm(runId, true);
    const result = await turn;
    await waitUntil(() => runEndsFor(result.runId).length === 1);
    const opts = h.run.mock.calls[0][0] as { gate?: { preApprovedReason?: string } };
    // The classifier reason for `rm -rf` — seeded so the identical mid-run command isn't re-asked.
    expect(opts.gate?.preApprovedReason).toBe('recursive file deletion (rm -r)');
  });

  it('aborts an unapproved destructive command event and retains the executor slot until the stream drains', async () => {
    const aborted = deferred();
    const drain = deferred();
    const streamDone = deferred();
    let sawAbort = false;

    h.run.mockImplementationOnce(async function* (opts: { signal?: AbortSignal }) {
      opts.signal?.addEventListener('abort', () => {
        sawAbort = true;
        aborted.resolve();
      }, { once: true });
      yield { kind: 'run.started', runId: 'executor-run-1', agent: 'codex', ts: 0 };
      yield { kind: 'command', runId: 'executor-run-1', itemId: 'cmd-1', status: 'started', command: 'rm -rf build', ts: 0 };
      await Promise.race([aborted.promise, drain.promise]);
      await drain.promise;
      yield { kind: 'run.completed', runId: 'executor-run-1', ok: true, finalText: 'late success', ts: 0 };
      streamDone.resolve();
    });

    try {
      const first = await runTurn({ transcript: 'inspect files', sessionId: 's' });
      await waitUntil(() => actionEventsFor(first.runId).some((item) => item.payload.kind === 'run.failed'));
      await flush();

      expect(sawAbort).toBe(true);
      expect(actionEventsFor(first.runId)).toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({
          kind: 'run.failed',
          error: expect.stringMatching(/blocked unapproved destructive command/i),
        }),
      });
      expect(actionEventsFor(first.runId)).not.toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({ kind: 'command', command: 'rm -rf build' }),
      });
      expect(runEndsFor(first.runId)).toHaveLength(1);

      const second = await runTurn({ transcript: 'second edit', sessionId: 's' });
      await flush();

      expect(h.run).toHaveBeenCalledTimes(1);
      expect(actionEventsFor(second.runId)).toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({
          kind: 'message',
          text: "I'm already working on something — Stop that first, or wait for it to finish.",
        }),
      });
      expect(runEndsFor(second.runId)).toHaveLength(1);

      drain.resolve();
      await streamDone.promise;
      await flush();

      expect(actionEventsFor(first.runId)).not.toContainEqual({
        ch: CH.actionEvent,
        payload: expect.objectContaining({ kind: 'run.completed' }),
      });

      const third = await runTurn({ transcript: 'third edit', sessionId: 's' });
      await waitUntil(() => h.run.mock.calls.length === 2);
      await flush();

      expect(runEndsFor(third.runId)).toHaveLength(1);
    } finally {
      drain.resolve();
      await flush();
    }
  });

  it('allows a destructive command after the existing confirm gate approved the destructive task', async () => {
    h.brain.decide.mockResolvedValueOnce({
      narration: 'on it',
      command: 'run_agent',
      args: { task: 'Remove the generated build directory with rm -rf build.' },
    });
    h.run.mockImplementationOnce(async function* () {
      yield { kind: 'run.started', runId: 'executor-run-approved', agent: 'codex', ts: 0 };
      yield { kind: 'command', runId: 'executor-run-approved', itemId: 'cmd-approved', status: 'started', command: 'rm -rf build', ts: 0 };
      yield { kind: 'run.completed', runId: 'executor-run-approved', ok: true, finalText: 'removed build', ts: 0 };
    });

    const turn = runTurn({ transcript: 'remove build', sessionId: 's' });
    await waitUntil(() => sent.some((item) => item.ch === CH.confirmRequest));
    const runId = sent.find((item) => item.ch === CH.confirmRequest)?.payload.runId;
    expect(runId).toBeTruthy();
    if (!runId) throw new Error('confirm request missing runId');
    resolveConfirm(runId, true);
    const result = await turn;
    await waitUntil(() => runEndsFor(result.runId).length === 1);

    expect(actionEventsFor(result.runId)).toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({ kind: 'command', command: 'rm -rf build' }),
    });
    expect(actionEventsFor(result.runId)).toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({ kind: 'run.completed', finalText: 'removed build' }),
    });
    expect(actionEventsFor(result.runId)).not.toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({ kind: 'run.failed' }),
    });
  });
});
