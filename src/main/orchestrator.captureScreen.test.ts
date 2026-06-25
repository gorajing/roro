import { describe, it, expect, vi, beforeEach } from 'vitest';

// First unit coverage of the orchestrator: the capture_screen loop must recall memory ONCE
// (before this turn's transcript is stored), reusing it for the post-vision re-decide — a second
// recall would self-match the just-persisted transcript as top "RELATED PAST CONTEXT".
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (): unknown[] => [] }, // no window -> pushEvent no-ops
  Notification: class { static isSupported() { return false; } show(): void { /* no-op mock */ } },
}));
vi.mock('./siblings', () => ({
  loadBrain: async () => h.brain,
  loadMemory: async () => h.memory,
  loadVision: async () => h.vision,
}));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));

import { runTurn } from './orchestrator';

describe('orchestrator capture_screen recall (no current-transcript self-match)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockImplementation(async (i: { owner_id: string; session_id: string; kind: string; text: string; payload?: unknown }) => ({
      id: 'x', owner_id: i.owner_id, session_id: i.session_id, kind: i.kind, text: i.text, payload: i.payload ?? null, superseded: false, created_at: 't',
    }));
    h.brain.extractFact.mockResolvedValue(null);
    h.vision.askScreen.mockResolvedValue('a screen description');
    let n = 0;
    h.brain.decide.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { narration: 'let me look at your screen', command: 'capture_screen', args: {} }
        : { narration: 'I see the error', command: 'answer', args: {} };
    });
  });

  it('recalls memory exactly once — the post-vision decide reuses the pre-store recall', async () => {
    await runTurn({ transcript: "what's this error on my screen", sessionId: 'sess-1' });
    expect(h.brain.decide).toHaveBeenCalledTimes(2); // capture_screen, then (post-vision) answer
    expect(h.vision.askScreen).toHaveBeenCalledTimes(1);
    // The fix: recall happens ONCE (before the transcript is stored), not again after.
    expect(h.memory.recall).toHaveBeenCalledTimes(1);
    expect(h.memory.getProfile).toHaveBeenCalledTimes(1);
  });
});
