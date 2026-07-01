import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendToPetWindow, sendToWebContents, sendToWindow } from './safeSend';
import { __test as __testRegistry, registerPetWindow } from './windowRegistry';

function fakeWebContents(options: {
  contentsDestroyed?: boolean;
  frameDestroyed?: boolean;
  frameDetached?: boolean;
  sendThrows?: boolean;
} = {}): Parameters<typeof sendToWebContents>[0] {
  const send = vi.fn(() => {
    if (options.sendThrows) throw new Error('frame disposed');
  });
  return {
    isDestroyed: () => Boolean(options.contentsDestroyed),
    mainFrame: {
      isDestroyed: () => Boolean(options.frameDestroyed),
      detached: Boolean(options.frameDetached),
      send,
    },
  } as unknown as Parameters<typeof sendToWebContents>[0];
}

function fakeWindow(options: {
  windowDestroyed?: boolean;
  contentsDestroyed?: boolean;
  frameDestroyed?: boolean;
  frameDetached?: boolean;
  sendThrows?: boolean;
} = {}): Parameters<typeof sendToWindow>[0] {
  return {
    isDestroyed: () => Boolean(options.windowDestroyed),
    on: vi.fn(),
    webContents: fakeWebContents(options),
  } as unknown as Parameters<typeof sendToWindow>[0];
}

describe('safeSend — guarded MAIN->renderer push IPC', () => {
  it('sends to a live main frame', () => {
    const win = fakeWindow();

    expect(sendToWindow(win, 'test:channel', { ok: true })).toBe(true);
  });

  it('drops sends when the window, contents, or frame are gone', () => {
    expect(sendToWindow(fakeWindow({ windowDestroyed: true }), 'test')).toBe(false);
    expect(sendToWindow(fakeWindow({ contentsDestroyed: true }), 'test')).toBe(false);
    expect(sendToWindow(fakeWindow({ frameDestroyed: true }), 'test')).toBe(false);
    expect(sendToWindow(fakeWindow({ frameDetached: true }), 'test')).toBe(false);
  });

  it('returns false instead of surfacing renderer teardown exceptions', () => {
    expect(sendToWindow(fakeWindow({ sendThrows: true }), 'test')).toBe(false);
  });

  it('guards direct WebContents sends from IPC request handlers', () => {
    expect(sendToWebContents(fakeWebContents(), 'test:channel', { ok: true })).toBe(true);
    expect(sendToWebContents(fakeWebContents({ contentsDestroyed: true }), 'test')).toBe(false);
    expect(sendToWebContents(fakeWebContents({ frameDestroyed: true }), 'test')).toBe(false);
    expect(sendToWebContents(fakeWebContents({ frameDetached: true }), 'test')).toBe(false);
    expect(sendToWebContents(fakeWebContents({ sendThrows: true }), 'test')).toBe(false);
  });
});

describe('sendToPetWindow — registry-targeted push (the overlay-hijack regression)', () => {
  afterEach(() => __testRegistry.reset());

  it('delivers to the REGISTERED pet window even when a newer overlay window exists', () => {
    // Regression for the P0: the click-through pointer overlay is a second BrowserWindow that
    // getAllWindows() orders FIRST (newest-first). Pushes must reach the pet, not the overlay.
    const pet = fakeWindow();
    const overlay = fakeWindow();
    registerPetWindow(pet as unknown as Parameters<typeof registerPetWindow>[0]);

    expect(sendToPetWindow('test:channel', { ok: true })).toBe(true);

    const petSend = (pet as unknown as { webContents: { mainFrame: { send: ReturnType<typeof vi.fn> } } })
      .webContents.mainFrame.send;
    const overlaySend = (overlay as unknown as { webContents: { mainFrame: { send: ReturnType<typeof vi.fn> } } })
      .webContents.mainFrame.send;
    expect(petSend).toHaveBeenCalledWith('test:channel', { ok: true });
    expect(overlaySend).not.toHaveBeenCalled();
  });

  it('returns false (guarded, no throw) when no pet window is registered', () => {
    expect(sendToPetWindow('test:channel')).toBe(false);
  });
});
