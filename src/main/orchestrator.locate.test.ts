import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CH } from '../shared/ipc';

// The fast locate path (args.locate): ONE vision call — ground + point + a short answer — with fail-loud
// grounding and Stop honored after the awaits. These tests pin the three correctness properties codex
// flagged: (1) a grounding ERROR surfaces as run.failed (not masked as "I can't find that"), (2) a genuine
// null answers "I can't find that", and (3) a Stop during grounding produces no paw and no answer.
const sent: Array<{ ch: unknown; payload: Record<string, unknown> }> = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), groundTarget: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));

import { installTestPorts, resetTestPorts } from '../core/ports/testing';
import { runTurn, cancelTask } from './orchestrator';

// The paw is drawn through the PointerOverlayPort; this observable no-op stands in for the shell's
// showPointForBox (installed as the pointerOverlay port in beforeEach) so the locate tests can assert
// the paw was (or wasn't) drawn.
const showPointForBox = vi.fn(async () => undefined);

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const messages = (): unknown[] =>
  sent.filter(({ ch, payload }) => ch === CH.actionEvent && payload.kind === 'message').map(({ payload }) => payload.text);
const failures = (): Array<Record<string, unknown>> =>
  sent.filter(({ ch, payload }) => ch === CH.actionEvent && payload.kind === 'run.failed').map(({ payload }) => payload);

describe('orchestrator fast locate path (args.locate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    installTestPorts({
      rendererPush: { send: (ch, ...args) => { sent.push({ ch, payload: args[0] as Record<string, unknown> }); return true; } },
      pointerOverlay: { showPointForBox },
    });
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockImplementation(async (i: Record<string, unknown>) => ({ id: 'x', ...i, superseded: false, created_at: 't' }));
    h.brain.extractFact.mockResolvedValue(null);
    h.vision.captureScreen.mockResolvedValue({ b64: 'zzz', mime: 'image/jpeg', width: 1000, height: 800 });
    // The locate gate would produce this; here we mock decide() to return it directly.
    h.brain.decide.mockResolvedValue({ narration: 'Let me look at your screen.', command: 'capture_screen', args: { locate: true } });
  });

  afterEach(() => {
    resetTestPorts();
  });

  it('grounds with ONE vision call, shows a paw, and answers "There it is."', async () => {
    h.brain.groundTarget.mockResolvedValue({ box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, confidence: 0.8 });
    const { runId } = await runTurn({ transcript: 'point at the save button', sessionId: 's' });
    await flush();
    expect(h.vision.captureScreen).toHaveBeenCalledTimes(1);
    expect(h.brain.groundTarget).toHaveBeenCalledTimes(1);
    expect(h.brain.describeScreen).not.toHaveBeenCalled(); // no caption/re-decide — single vision call
    expect(h.brain.decide).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showPointForBox)).toHaveBeenCalledTimes(1);
    expect(messages()).toContain('There it is.');
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
  });

  it('answers "I can\'t find that on your screen." on a genuine null (no failure)', async () => {
    h.brain.groundTarget.mockResolvedValue(null);
    await runTurn({ transcript: 'point at the nonexistent widget', sessionId: 's' });
    await flush();
    expect(messages()).toContain("I can't find that on your screen.");
    expect(vi.mocked(showPointForBox)).not.toHaveBeenCalled();
    expect(failures()).toHaveLength(0);
  });

  it('surfaces a grounding ERROR as run.failed — NOT masked as not-found (fail-loud)', async () => {
    h.brain.groundTarget.mockRejectedValue(new Error('model qwen2.5vl not found'));
    const { runId } = await runTurn({ transcript: 'point at the save button', sessionId: 's' });
    await flush();
    expect(failures()).toHaveLength(1);
    expect(failures()[0].error).toBe('vision failed: model qwen2.5vl not found');
    expect(messages()).not.toContain("I can't find that on your screen.");
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
  });

  it('a NON-locate screen turn captions WITHOUT grounding (no paw, no extra serialized vision call)', async () => {
    // "what's this error on my screen" → capture_screen WITHOUT args.locate → caption + re-decide, no paw.
    // Regression guard: grounding here would queue a second call on the same vision model and slow the answer.
    let n = 0;
    h.brain.decide.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { narration: 'let me look', command: 'capture_screen', args: {} }
        : { narration: 'I see the error', command: 'answer', args: {} };
    });
    h.vision.askScreen.mockImplementation(async (_t: string, describe: (img: unknown) => Promise<string>) =>
      describe({ b64: 'z', mime: 'image/jpeg', width: 1000, height: 800 }),
    );
    h.brain.describeScreen.mockResolvedValue('a screen description');

    await runTurn({ transcript: "what's this error on my screen", sessionId: 's' });
    await flush();

    expect(h.vision.askScreen).toHaveBeenCalledTimes(1);
    expect(h.brain.describeScreen).toHaveBeenCalledTimes(1);
    expect(h.brain.groundTarget).not.toHaveBeenCalled();
    expect(vi.mocked(showPointForBox)).not.toHaveBeenCalled();
  });

  it('honors a Stop that arrives during grounding — no paw, no answer', async () => {
    h.brain.groundTarget.mockImplementation(async () => {
      cancelTask(); // user hits Stop while the vision call is in flight
      return { box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, confidence: 0.8 };
    });
    await runTurn({ transcript: 'point at the save button', sessionId: 's' });
    await flush();
    expect(vi.mocked(showPointForBox)).not.toHaveBeenCalled();
    expect(messages()).not.toContain('There it is.');
    expect(failures().some((p) => p.error === 'stopped')).toBe(true);
  });
});
