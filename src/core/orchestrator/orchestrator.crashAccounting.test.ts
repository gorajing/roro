import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// c5: a coding-agent run whose stream ends with NO terminal event (crash / nonzero exit / killed — the
// adapters emit a terminal on BOTH success and failure, so a missing verdict means the child died) must be
// reported as run.failed, NEVER a synthesized run.completed. A false "done" misleads the user AND persists a
// fabricated success to memory. Here a fake window CAPTURES the pushed events so we can assert the verdict.

const sent: Array<{ ch: unknown; ev: { kind?: string } }> = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));

import { installTestPorts, resetTestPorts } from '../ports/testing';
import { runTurn } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('orchestrator: a no-verdict stream fails loud (no false run.completed)', () => {
  let savedAllowCwd: string | undefined;
  let savedCodexBin: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    installTestPorts({ rendererPush: { send: (ch, ...args) => { sent.push({ ch, ev: args[0] as { kind?: string } }); return true; } } });
    savedAllowCwd = process.env.RORO_ALLOW_CWD;
    savedCodexBin = process.env.RORO_CODEX_BIN;
    process.env.RORO_ALLOW_CWD = '1';
    process.env.RORO_CODEX_BIN = process.execPath;
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.extractFact.mockResolvedValue(null);
    h.brain.decide.mockResolvedValue({ narration: 'on it', command: 'run_agent', args: { task: 'edit a file' } });
  });
  afterEach(() => {
    resetTestPorts();
    if (savedAllowCwd === undefined) delete process.env.RORO_ALLOW_CWD;
    else process.env.RORO_ALLOW_CWD = savedAllowCwd;
    if (savedCodexBin === undefined) delete process.env.RORO_CODEX_BIN;
    else process.env.RORO_CODEX_BIN = savedCodexBin;
  });

  it('synthesizes run.failed (not run.completed) when the executor stream ends with no terminal event', async () => {
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.started', runId: 'r', agent: 'codex', ts: 0 };
      // ...then the stream just ENDS — no run.completed / run.failed (a crash with no result)
    });
    await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();
    const kinds = sent.map((s) => s.ev?.kind);
    expect(kinds).toContain('run.failed'); // failed loud
    expect(kinds).not.toContain('run.completed'); // NEVER a fabricated success
  });

  it('still reports run.completed when the stream DOES emit a real completion (no false negative)', async () => {
    h.run.mockImplementation(async function* () {
      yield { kind: 'run.started', runId: 'r', agent: 'codex', ts: 0 };
      yield { kind: 'run.completed', runId: 'r', ok: true, finalText: 'done', ts: 0 };
    });
    await runTurn({ transcript: 'edit a file', sessionId: 's' });
    await flush();
    const kinds = sent.map((s) => s.ev?.kind);
    expect(kinds).toContain('run.completed'); // a real success is still a success
  });
});
