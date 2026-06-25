// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountBootstrapBanner } from './bootstrapBanner';
import type { BootstrapStatusMsg, ModelPullProgressMsg } from '../../shared/ipc';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (s: string): HTMLElement | null => document.querySelector(s);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

const MISSING: BootstrapStatusMsg = {
  ready: false,
  needsOllamaInstall: false,
  missing: [{ name: 'qwen2.5:3b', bytes: 1_900_000_000 }, { name: 'nomic-embed-text', bytes: 274_000_000 }],
  essentialBytes: 2_174_000_000,
};

function setup(over: { pull?: ReturnType<typeof vi.fn>; getStatus?: ReturnType<typeof vi.fn> } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  let push: ((s: BootstrapStatusMsg | null) => void) | null = null;
  const subscribe = (cb: (s: BootstrapStatusMsg | null) => void): (() => void) => { push = cb; return () => undefined; };
  const pull = over.pull ?? vi.fn(async () => undefined);
  const getStatus = over.getStatus ?? vi.fn(async () => null);
  const unmount = mountBootstrapBanner({ subscribe, getStatus, pull });
  return { emit: (s: BootstrapStatusMsg | null) => push?.(s), pull, getStatus, unmount };
}

describe('mountBootstrapBanner — one-click first-run model download (M7b UI)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is hidden until a not-ready status arrives, and hidden when ready', () => {
    const t = setup();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(true);
    t.emit({ ready: true, needsOllamaInstall: false, missing: [], essentialBytes: 0 });
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(true);
  });

  it('when Ollama isn\'t running: shows an install hint and NO download button (can\'t pull yet)', () => {
    const t = setup();
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/install/i);
    expect(q('#bootstrap-download')).toBeNull();
  });

  it('when reachable + models missing: shows the honest size + a Download button', () => {
    const t = setup();
    t.emit(MISSING);
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/2\.2 GB/);
    expect(q('#bootstrap-download')).toBeTruthy();
  });

  it('clicking Download pulls the missing models and renders streamed progress', async () => {
    let onProg: ((p: ModelPullProgressMsg) => void) | null = null;
    const pull = vi.fn((_names: string[], cb: (p: ModelPullProgressMsg) => void) => { onProg = cb; return new Promise<void>(() => undefined); });
    const t = setup({ pull });
    t.emit(MISSING);
    click(q('#bootstrap-download'));
    await flush();
    expect(pull).toHaveBeenCalledWith(['qwen2.5:3b', 'nomic-embed-text'], expect.any(Function));
    onProg?.({ model: 'qwen2.5:3b', status: 'downloading', percent: 42 });
    expect(q('#bootstrap-banner')?.textContent).toMatch(/42%/);
    expect((q('#bootstrap-download') as HTMLButtonElement)?.disabled).toBe(true); // no double-pull
  });

  it('on the done tick the banner reports ready', async () => {
    let onProg: ((p: ModelPullProgressMsg) => void) | null = null;
    const pull = vi.fn((_n: string[], cb: (p: ModelPullProgressMsg) => void) => { onProg = cb; return Promise.resolve(); });
    const t = setup({ pull });
    t.emit(MISSING);
    click(q('#bootstrap-download'));
    await flush();
    onProg?.({ model: 'nomic-embed-text', status: 'success', done: true });
    await flush();
    expect(q('#bootstrap-banner')?.textContent).toMatch(/ready/i);
  });

  it('fails loud on a pull error — shows it and re-enables Download for retry', async () => {
    const pull = vi.fn(async () => { throw new Error('connection reset'); });
    const t = setup({ pull });
    t.emit(MISSING);
    click(q('#bootstrap-download'));
    await flush();
    expect(q('#bootstrap-banner')?.textContent).toMatch(/connection reset|failed/i);
    expect((q('#bootstrap-download') as HTMLButtonElement).disabled).toBe(false);
  });

  it('RECOVERS a status pushed before subscribe by fetching it on mount (the startup-race fix)', async () => {
    // Simulate the race: the push was missed (emit never called); getStatus() returns the missed status.
    const t = setup({ getStatus: vi.fn(async () => MISSING) });
    await flush();
    expect(t.getStatus).toHaveBeenCalled();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-download')).toBeTruthy(); // the banner appears despite the dropped push
  });

  it('unmount detaches the subscription + removes the banner', () => {
    const t = setup();
    t.unmount();
    expect(q('#bootstrap-banner')).toBeNull();
  });
});
