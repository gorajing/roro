import { describe, expect, it, vi } from 'vitest';
import { sendToWebContents, sendToWindow } from './safeSend';

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
