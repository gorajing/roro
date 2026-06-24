import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase B hinge: turnRun must resolve at DISPATCH (return {runId} once the executor is handed
// off), NOT after the whole run finishes — that's what makes Stop / preempt / voice barge-in
// wireable. Here the executor stream blocks mid-run; turnRun must still resolve.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
  Notification: class { static isSupported() { return false; } show(): void { /* no-op mock */ } },
}));
vi.mock('./siblings', () => ({
  loadBrain: async () => h.brain,
  loadMemory: async () => h.memory,
  loadVision: async () => h.vision,
}));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));

import { runTurn } from './orchestrator';

describe('orchestrator dispatch-return: turnRun resolves at dispatch', () => {
  let savedAllowCwd: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    // Make dispatch deterministic regardless of .env / CI: this turn must reach the executor, so opt into
    // cwd as the repo (the run_agent path now fails loud without a chosen repo — see orchestrator.workdir.test).
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    process.env.RORO_ALLOW_CWD = '1';
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.extractFact.mockResolvedValue(null);
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'do the thing' } });
  });
  afterEach(() => {
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
  });

  it('returns {runId} before the executor run reaches its terminal event', async () => {
    const gate = deferred();
    let reachedTerminal = false;
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.started', runId: 'r', agent: 'codex', ts: 0 };
      await gate.promise; // block the run mid-stream
      reachedTerminal = true;
      yield { kind: 'run.completed', runId: 'r', ok: true, finalText: 'done', ts: 0 };
    });

    const { runId } = await runTurn({ transcript: 'do the thing', sessionId: 's' });

    expect(runId).toBeTruthy();
    expect(h.run).toHaveBeenCalled(); // it actually reached the executor (not the new fail-loud path)
    expect(reachedTerminal).toBe(false); // resolved at dispatch, not at completion
    gate.resolve(); // unblock the background run (cleanup)
    await new Promise((r) => setImmediate(r));
  }, 2000);
});
