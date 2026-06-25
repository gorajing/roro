import { describe, it, expect, vi, beforeEach } from 'vitest';

// Observability: the orchestrator's single extraction seam (runFactExtraction) must record WHY a turn
// did/didn't produce a fact — gated (no marker), noop (model returned null), stored, reinforced, failed —
// so "Memory: 0 known facts" is diagnosable instead of an invisible fire-and-forget. These tests drive a
// real answer turn and assert memory.traceExtraction is called with the right stage.
const h = vi.hoisted(() => ({
  memory: {
    remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(),
    replaceFact: vi.fn(), reinforceFact: vi.fn(), forgetFact: vi.fn(), traceExtraction: vi.fn(),
  },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (): unknown[] => [] }, // no window -> pushEvent no-ops
  Notification: class { static isSupported() { return false; } show(): void { /* no-op */ } },
}));
vi.mock('./siblings', () => ({
  loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision,
}));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));

import { runTurn } from './orchestrator';

function rowFor(i: { owner_id: string; session_id: string; kind?: string; text: string; payload?: unknown }) {
  return { id: 'x', owner_id: i.owner_id, session_id: i.session_id, kind: i.kind ?? 'fact', text: i.text, payload: i.payload ?? null, superseded: false, created_at: 't' };
}

describe('orchestrator fact-extraction trace (observability)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]); // no existing fact for the key -> a write inserts
    h.memory.remember.mockImplementation(async (i) => rowFor(i));
    h.memory.replaceFact.mockImplementation(async (i) => rowFor(i));
    h.memory.reinforceFact.mockResolvedValue(null);
    // A plain answer turn -> runFactExtraction(outcome:'answered').
    h.brain.decide.mockResolvedValue({ narration: 'sure', command: 'answer', args: {} });
  });

  it("traces stage 'gated' AND skips the model when the transcript has no preference marker", async () => {
    h.brain.extractFact.mockResolvedValue(null);
    await runTurn({ transcript: 'reverse a list in python', sessionId: 's1' });
    await vi.waitFor(() => expect(h.memory.traceExtraction).toHaveBeenCalled());
    expect(h.memory.traceExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'extract', stage: 'gated', ownerId: 'owner-test', sessionId: 's1', outcome: 'answered' }),
    );
    expect(h.brain.extractFact).not.toHaveBeenCalled(); // gated -> the model is never consulted
  });

  it("traces stage 'noop' (model_null) when the gate passes but the model returns null", async () => {
    h.brain.extractFact.mockResolvedValue(null);
    await runTurn({ transcript: 'i always use pnpm here', sessionId: 's2' });
    await vi.waitFor(() => expect(h.memory.traceExtraction).toHaveBeenCalled());
    expect(h.brain.extractFact).toHaveBeenCalled(); // gate passed -> model consulted
    expect(h.memory.traceExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'noop', reason: 'model_null' }),
    );
  });

  it("traces stage 'stored' with the factKey when a fact is extracted + written", async () => {
    h.brain.extractFact.mockResolvedValue({ key: 'package_manager', value: 'pnpm' });
    await runTurn({ transcript: 'i always use pnpm here', sessionId: 's3' });
    await vi.waitFor(() =>
      expect(h.memory.traceExtraction).toHaveBeenCalledWith(expect.objectContaining({ stage: 'stored' })),
    );
    expect(h.memory.traceExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'stored', factKey: 'package_manager' }),
    );
  });

  it("traces stage 'reinforced' when the same key+value is corroborated (no rewrite)", async () => {
    // The key already has exactly this value -> storeFact reinforces in place, never replaceFact.
    const existing = { id: 'f1', owner_id: 'owner-test', session_id: 'old', kind: 'fact', text: 'pnpm', payload: { key: 'package_manager', value: 'pnpm' }, superseded: false, created_at: 't' };
    h.memory.getProfile.mockResolvedValue([existing]);
    h.memory.reinforceFact.mockResolvedValue(existing);
    h.brain.extractFact.mockResolvedValue({ key: 'package_manager', value: 'pnpm' });
    await runTurn({ transcript: 'i always use pnpm here', sessionId: 's4' });
    await vi.waitFor(() =>
      expect(h.memory.traceExtraction).toHaveBeenCalledWith(expect.objectContaining({ stage: 'reinforced' })),
    );
    expect(h.memory.replaceFact).not.toHaveBeenCalled(); // corroboration, not a durable rewrite
  });

  it("traces stage 'failed' (fail-loud) when the store write throws — never a silent miss", async () => {
    h.brain.extractFact.mockResolvedValue({ key: 'package_manager', value: 'pnpm' });
    h.memory.replaceFact.mockRejectedValueOnce(new Error('disk full')); // the atomic write fails
    await runTurn({ transcript: 'i always use pnpm here', sessionId: 's5' });
    await vi.waitFor(() =>
      expect(h.memory.traceExtraction).toHaveBeenCalledWith(expect.objectContaining({ stage: 'failed' })),
    );
    expect(h.memory.traceExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'failed', reason: expect.stringContaining('disk full') }),
    );
  });
});
