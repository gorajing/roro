import { describe, expect, it, vi } from 'vitest';
import { sendToWindow } from './safeSend';

function fakeWindow(options: {
  windowDestroyed?: boolean;
  contentsDestroyed?: boolean;
  frameDestroyed?: boolean;
  frameDetached?: boolean;
  sendThrows?: boolean;
} = {}): Parameters<typeof sendToWindow>[0] {
  const send = vi.fn(() => {
    if (options.sendThrows) throw new Error('frame disposed');
  });
  return {
    isDestroyed: () => Boolean(options.windowDestroyed),
    webContents: {
      isDestroyed: () => Boolean(options.contentsDestroyed),
      mainFrame: {
        isDestroyed: () => Boolean(options.frameDestroyed),
        detached: Boolean(options.frameDetached),
        send,
      },
    },
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
});
