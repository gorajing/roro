import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CH } from '../shared/ipc';
import { SCREEN_CAPTURE_STATUS_TEXT } from '../shared/events';

// First unit coverage of the orchestrator: the capture_screen loop must recall memory ONCE
// (before this turn's transcript is stored), reusing it for the post-vision re-decide — a second
// recall would self-match the just-persisted transcript as top "RELATED PAST CONTEXT".
const sent: Array<{ ch: unknown; payload: Record<string, unknown> }> = [];
const order: string[] = [];
const h = vi.hoisted(() => ({
  memory: { remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(), traceExtraction: vi.fn() },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), embed: vi.fn(), extractFact: vi.fn() },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
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
          send: (ch: unknown, payload: Record<string, unknown>) => {
            sent.push({ ch, payload });
            if (ch === CH.actionEvent && payload.kind === 'status' && payload.text === SCREEN_CAPTURE_STATUS_TEXT) {
              order.push('tell');
            }
          },
        },
      },
    }],
  },
  Notification: class { static isSupported() { return false; } show(): void { /* no-op mock */ } },
}));
vi.mock('./siblings', () => ({
  loadBrain: async () => h.brain,
  loadMemory: async () => h.memory,
  loadVision: async () => h.vision,
}));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));

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

import { runTurn } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const screenTellEvents = () =>
  sent.filter(({ ch, payload }) => ch === CH.actionEvent && payload.kind === 'status' && payload.text === SCREEN_CAPTURE_STATUS_TEXT);

describe('orchestrator capture_screen recall (no current-transcript self-match)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    order.length = 0;
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockImplementation(async (i: { owner_id: string; session_id: string; kind: string; text: string; payload?: unknown }) => ({
      id: 'x', owner_id: i.owner_id, session_id: i.session_id, kind: i.kind, text: i.text, payload: i.payload ?? null, superseded: false, created_at: 't',
    }));
    h.brain.extractFact.mockResolvedValue(null);
    h.vision.askScreen.mockImplementation(async () => {
      order.push('askScreen');
      return 'a screen description';
    });
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

  it('emits the screen-capture tell before vision.askScreen', async () => {
    const { runId } = await runTurn({ transcript: "what's this error on my screen", sessionId: 'sess-1' });

    expect(screenTellEvents()).toHaveLength(1);
    expect(sent).toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({ kind: 'status', runId, text: SCREEN_CAPTURE_STATUS_TEXT }),
    });
    expect(order).toEqual(expect.arrayContaining(['tell', 'askScreen']));
    expect(order.indexOf('tell')).toBeLessThan(order.indexOf('askScreen'));
    expect(h.vision.askScreen).toHaveBeenCalledTimes(1);
    expect(h.brain.decide).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the tell when the post-vision decide asks to capture_screen again', async () => {
    h.brain.decide.mockResolvedValue({
      narration: 'I already took one snapshot, so I will answer from that.',
      command: 'capture_screen',
      args: {},
    });

    const { runId } = await runTurn({ transcript: 'read what is on my screen', sessionId: 'sess-1' });

    expect(screenTellEvents()).toHaveLength(1);
    expect(h.vision.askScreen).toHaveBeenCalledTimes(1);
    expect(h.brain.decide).toHaveBeenCalledTimes(2);
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
  });

  it('does not persist the screen-capture tell into memory', async () => {
    await runTurn({ transcript: 'read what is on my screen', sessionId: 'sess-1' });
    await flush();

    expect(screenTellEvents()).toHaveLength(1);
    const remembered = h.memory.remember.mock.calls.map(([input]) => input as { text?: string; payload?: { text?: string } });
    expect(remembered.some((input) => input.text === SCREEN_CAPTURE_STATUS_TEXT || input.payload?.text === SCREEN_CAPTURE_STATUS_TEXT)).toBe(false);
  });

  it('still tells first when vision fails, then emits a terminal failure', async () => {
    h.vision.askScreen.mockImplementationOnce(async () => {
      order.push('askScreen');
      throw new Error('screen permission denied');
    });

    const { runId } = await runTurn({ transcript: 'read what is on my screen', sessionId: 'sess-1' });

    expect(screenTellEvents()).toHaveLength(1);
    expect(order.indexOf('tell')).toBeLessThan(order.indexOf('askScreen'));
    expect(sent).toContainEqual({
      ch: CH.actionEvent,
      payload: expect.objectContaining({
        kind: 'run.failed',
        runId,
        error: 'vision failed: screen permission denied',
      }),
    });
    expect(sent).toContainEqual({ ch: CH.runEnd, payload: { runId } });
    expect(h.brain.decide).toHaveBeenCalledTimes(1);
    expect(h.memory.traceExtraction).not.toHaveBeenCalled();
  });
});
