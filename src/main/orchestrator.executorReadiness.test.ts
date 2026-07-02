import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';

const sent: Array<{ ch: string; payload: { kind?: string; runId?: string; text?: string; error?: string; agent?: string } }> = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeBrain: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
  getExecutorReadiness: vi.fn(),
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));
vi.mock('./executorReadiness', () => ({ getExecutorReadiness: h.getExecutorReadiness }));

import { installTestPorts, resetTestPorts } from '../core/ports/testing';
import { runTurn } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
async function waitUntil(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`condition timed out; sent=${JSON.stringify(sent)}`);
}

describe('orchestrator executor readiness boundary', () => {
  let savedAllowCwd: string | undefined;
  let savedWorkdir: string | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    sent.length = 0;
    installTestPorts({ rendererPush: { send: (ch, ...args) => { sent.push({ ch, payload: args[0] as { kind?: string; runId?: string; text?: string; error?: string; agent?: string } }); return true; } } });
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    savedWorkdir = process.env.RORO_WORKDIR;
    process.env.RORO_ALLOW_CWD = '1';
    delete process.env.RORO_WORKDIR;
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.describeBrain.mockReturnValue('test brain');
    h.brain.extractFact.mockResolvedValue(null);
    h.getExecutorReadiness.mockResolvedValue({
      ready: true,
      agent: 'codex',
      command: 'codex',
      envVar: 'RORO_CODEX_BIN',
      path: process.execPath,
      source: 'env',
      message: 'Codex CLI is ready.',
    });
    h.run.mockImplementation(async function* (opts: { agent?: string }) {
      yield { kind: 'run.started', runId: 'executor-run', agent: opts.agent ?? 'codex', ts: 0 };
      yield { kind: 'run.completed', runId: 'executor-run', ok: true, finalText: 'done', ts: 0 };
    });
  });

  afterEach(() => {
    resetTestPorts();
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
    if (savedWorkdir === undefined) delete process.env.RORO_WORKDIR;
    else process.env.RORO_WORKDIR = savedWorkdir;
  });

  it('does not require executor readiness for answer turns', async () => {
    h.getExecutorReadiness.mockResolvedValueOnce({
      ready: false,
      agent: 'codex',
      command: 'codex',
      envVar: 'RORO_CODEX_BIN',
      path: 'codex',
      source: 'bare',
      message: 'Codex CLI not found. Install it, make sure it is on PATH, or set RORO_CODEX_BIN.',
    });
    h.brain.decide.mockResolvedValue({ narration: 'Here is the answer.', command: 'answer', args: {} });

    await runTurn({ transcript: 'what is a route?', sessionId: 's' });
    await flush();

    expect(h.getExecutorReadiness).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({
      ch: CH.actionEvent,
      payload: expect.objectContaining({ kind: 'message', text: 'Here is the answer.' }),
    }));
    expect(sent.some((item) => item.payload.kind === 'run.failed')).toBe(false);
  });

  it('fails a run_agent turn before spawning when the selected executor is unavailable', async () => {
    h.getExecutorReadiness.mockResolvedValueOnce({
      ready: false,
      agent: 'codex',
      command: 'codex',
      envVar: 'RORO_CODEX_BIN',
      path: 'codex',
      source: 'bare',
      message: 'Codex CLI not found. Install it, make sure it is on PATH, or set RORO_CODEX_BIN.',
    });
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file' } });

    const { runId } = await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();

    expect(h.getExecutorReadiness).toHaveBeenCalledWith('codex');
    expect(h.run).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({
      ch: CH.actionEvent,
      payload: expect.objectContaining({
        kind: 'run.failed',
        runId,
        error: expect.stringContaining('Codex CLI not found'),
      }),
    }));
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
    expect(sent.some((item) => item.payload.kind === 'message' && item.payload.text === 'on it')).toBe(false);
  });

  it('checks Claude readiness when the brain selects Claude', async () => {
    h.getExecutorReadiness.mockResolvedValueOnce({
      ready: true,
      agent: 'claude',
      command: 'claude',
      envVar: 'RORO_CLAUDE_BIN',
      path: process.execPath,
      source: 'env',
      message: 'Claude CLI is ready.',
    });
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file', agent: 'claude' } });

    await runTurn({ transcript: 'edit a file with claude', sessionId: 's' });
    await waitUntil(() => h.run.mock.calls.length > 0);

    expect(h.getExecutorReadiness).toHaveBeenCalledWith('claude');
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }));
  });
});
