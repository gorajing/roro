import { afterEach, describe, expect, it, vi } from 'vitest';

// The overlay must only ever exist while the pet window does: a locate turn's grounding can take
// 40-150s, so the pet can close mid-turn — re-creating the overlay AFTER the pet's `closed` cleanup
// would orphan an invisible always-on-top window (blocks window-all-closed quit, dock re-activation,
// and the summon shortcut). These tests pin the "no pet -> no overlay" guard.

const { BrowserWindowMock } = vi.hoisted(() => ({
  BrowserWindowMock: vi.fn(function (this: Record<string, unknown>) {
    return {
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setBounds: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1440, height: 900 })),
      showInactive: vi.fn(),
      on: vi.fn(),
      isDestroyed: () => false,
      destroy: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      webContents: { once: vi.fn(), executeJavaScript: vi.fn(async () => undefined) },
    };
  }),
}));

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }) },
}));

import { destroyPointerOverlay, ensurePointerOverlay, showPointAt } from './pointerOverlay';
import { __test as __testRegistry, registerPetWindow } from './windowRegistry';

const fakePet = () =>
  ({ isDestroyed: () => false, on: vi.fn() }) as unknown as Parameters<typeof registerPetWindow>[0];

describe('pointerOverlay — no pet window, no overlay', () => {
  afterEach(() => {
    destroyPointerOverlay();
    __testRegistry.reset();
    BrowserWindowMock.mockClear();
  });

  it('refuses to create the overlay when no pet window is registered (the orphan race)', () => {
    expect(ensurePointerOverlay()).toBeNull();
    expect(BrowserWindowMock).not.toHaveBeenCalled();
  });

  it('showPointAt is a safe no-op when the pet window is gone', async () => {
    await expect(showPointAt({ x: 100, y: 100 }, 0.9)).resolves.toBeUndefined();
    expect(BrowserWindowMock).not.toHaveBeenCalled();
  });

  it('creates the overlay while a live pet window exists', () => {
    registerPetWindow(fakePet());
    const overlay = ensurePointerOverlay();
    expect(overlay).not.toBeNull();
    expect(BrowserWindowMock).toHaveBeenCalledTimes(1);
  });
});
