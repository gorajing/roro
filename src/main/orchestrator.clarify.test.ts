import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';

const sent: Array<{ ch: unknown; payload: { kind?: string; text?: string; runId?: string } }> = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));

import { installTestPorts, resetTestPorts } from '../core/ports/testing';
import { runTurn } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('orchestrator clarify turns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    installTestPorts({ rendererPush: { send: (ch, ...args) => { sent.push({ ch, payload: args[0] as { kind?: string; text?: string; runId?: string } }); return true; } } });
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockResolvedValue({ id: 'x', owner_id: 'O', session_id: 's', kind: 'observation', text: '', payload: null, superseded: false, created_at: 't' });
    h.brain.extractFact.mockResolvedValue(null);
    h.brain.decide.mockResolvedValue({
      narration: 'What should I fix, and where should I look?',
      command: 'clarify',
      args: { question: 'What should I fix, and where should I look?' },
    });
  });

  afterEach(() => {
    resetTestPorts();
  });

  it('asks one question, ends the run, and does not call executor or vision', async () => {
    const { runId } = await runTurn({ transcript: 'fix it', sessionId: 's1' });
    await flush();

    expect(h.run).not.toHaveBeenCalled();
    expect(h.vision.askScreen).not.toHaveBeenCalled();
    expect(sent).toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({
        kind: 'message',
        runId,
        text: 'What should I fix, and where should I look?',
      }),
    });
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
    await vi.waitFor(() => expect(h.memory.traceExtraction).toHaveBeenCalled());
    expect(h.memory.traceExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'extract', stage: 'gated', outcome: 'answered', sessionId: 's1' }),
    );
  });
});
