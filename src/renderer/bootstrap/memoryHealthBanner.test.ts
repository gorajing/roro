// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountMemoryHealthBanner } from './memoryHealthBanner';
import type { MemoryHealthStatusMsg } from '../../shared/ipc';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (s: string): HTMLElement | null => document.querySelector(s);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

const DEGRADED: MemoryHealthStatusMsg = {
  state: 'degraded',
  checkedAt: 111,
  reason: 'keychain-unavailable',
  message: 'Roro cannot reach the OS keychain.',
};

function setup(over: { getStatus?: ReturnType<typeof vi.fn> } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  let push: ((s: MemoryHealthStatusMsg | null) => void) | null = null;
  const subscribe = (cb: (s: MemoryHealthStatusMsg | null) => void): (() => void) => { push = cb; return () => undefined; };
  const getStatus = over.getStatus ?? vi.fn(async () => null);
  const unmount = mountMemoryHealthBanner({ subscribe, getStatus });
  return { emit: (s: MemoryHealthStatusMsg | null) => push?.(s), getStatus, unmount };
}

describe('mountMemoryHealthBanner — non-blocking memory/keychain diagnostic', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is hidden for null, checking, and ok statuses', () => {
    const t = setup();
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(true);
    t.emit({ state: 'checking', checkedAt: 1 });
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(true);
    t.emit({ state: 'ok', checkedAt: 2 });
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(true);
  });

  it('shows friendly keychain copy for degraded memory without mentioning cloud keys', () => {
    const t = setup();
    t.emit(DEGRADED);
    const text = q('#memory-health-banner')?.textContent ?? '';
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(false);
    expect(text).toMatch(/Local memory is paused/);
    expect(text).toMatch(/Roro can still code/);
    expect(text).toMatch(/macOS Keychain/);
    expect(text).not.toMatch(/cloud|API key/i);
  });

  it('reveals local-only details on demand', () => {
    const t = setup();
    t.emit(DEGRADED);
    click(q('#memory-health-details'));
    const text = q('#memory-health-banner')?.textContent ?? '';
    expect(text).toMatch(/lives on this Mac/);
    expect(text).toMatch(/not a cloud login or API key issue/i);
    expect(text).toMatch(/Roro Key/);
  });

  it('dismisses only the current degraded snapshot', () => {
    const t = setup();
    t.emit(DEGRADED);
    click(q('#memory-health-dismiss'));
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(true);

    t.emit(DEGRADED);
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(true);

    t.emit({ ...DEGRADED, checkedAt: 222 });
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(false);
  });

  it('recovers a status pushed before subscribe by fetching it on mount', async () => {
    const t = setup({ getStatus: vi.fn(async () => DEGRADED) });
    await flush();
    expect(t.getStatus).toHaveBeenCalled();
    expect((q('#memory-health-banner') as HTMLElement).hidden).toBe(false);
  });

  it('unmount removes the banner', () => {
    const t = setup();
    t.unmount();
    expect(q('#memory-health-banner')).toBeNull();
  });
});
