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

function setup(over: {
  pull?: ReturnType<typeof vi.fn>;
  getStatus?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
  openExternal?: ReturnType<typeof vi.fn>;
} = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  let push: ((s: BootstrapStatusMsg | null) => void) | null = null;
  const subscribe = (cb: (s: BootstrapStatusMsg | null) => void): (() => void) => { push = cb; return () => undefined; };
  const pull = over.pull ?? vi.fn(async () => undefined);
  const getStatus = over.getStatus ?? vi.fn(async () => null);
  const refresh = over.refresh ?? vi.fn(async () => null);
  const openExternal = over.openExternal ?? vi.fn();
  const unmount = mountBootstrapBanner({ subscribe, getStatus, refresh, pull, openExternal });
  return { emit: (s: BootstrapStatusMsg | null) => push?.(s), pull, getStatus, refresh, openExternal, unmount };
}

describe('mountBootstrapBanner — one-click first-run model download (M7b UI)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is hidden until a not-ready status arrives, and hidden when ready', () => {
    const t = setup();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(true);
    t.emit({ ready: true, needsOllamaInstall: false, missing: [], essentialBytes: 0 });
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(true);
  });

  it('when Ollama isn\'t running: shows install/start guidance + Get Ollama/Recheck actions', () => {
    const t = setup();
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/install/i);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/check again/i);
    expect(q('#bootstrap-download')).toBeNull(); // can't pull until Ollama runs
    expect(q('#bootstrap-get-ollama')).toBeTruthy(); // but DO help them install it
    expect(q('#bootstrap-refresh')).toBeTruthy();
  });

  it('the "Get Ollama" button opens the official download page (no shell-out auto-install)', () => {
    const openExternal = vi.fn();
    const t = setup({ openExternal });
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });
    click(q('#bootstrap-get-ollama'));
    expect(openExternal).toHaveBeenCalledWith('https://ollama.com/download');
  });

  it('when reachable + models missing: shows the honest size + a Download button', () => {
    const t = setup();
    t.emit(MISSING);
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/2\.2 GB/);
    expect(q('#bootstrap-download')).toBeTruthy();
    expect(q('#bootstrap-refresh')).toBeTruthy();
  });

  it('clicking Recheck asks MAIN to refresh and applies the returned ready status', async () => {
    const refresh = vi.fn(async () => ({ ready: true, needsOllamaInstall: false, missing: [], essentialBytes: 0 }));
    const t = setup({ refresh });
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });

    click(q('#bootstrap-refresh'));
    expect(q('#bootstrap-banner')?.textContent).toMatch(/checking/i);
    await flush();

    expect(refresh).toHaveBeenCalled();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(true);
    expect(q('#bootstrap-refresh')).toBeNull();
  });

  it('clicking Recheck fails loud and leaves the button retryable', async () => {
    const refresh = vi.fn(async () => { throw new Error('daemon still down'); });
    const t = setup({ refresh });
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });

    click(q('#bootstrap-refresh'));
    await flush();

    expect(q('#bootstrap-banner')?.textContent).toMatch(/daemon still down/);
    expect((q('#bootstrap-refresh') as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Recheck with no fresh status keeps the visible branch retryable', async () => {
    const refresh = vi.fn(async () => null);
    const t = setup({ refresh });
    t.emit({ ready: false, needsOllamaInstall: true, missing: [], essentialBytes: 0 });

    click(q('#bootstrap-refresh'));
    await flush();

    expect(q('#bootstrap-banner')?.textContent).toMatch(/try again/i);
    expect((q('#bootstrap-refresh') as HTMLButtonElement).disabled).toBe(false);
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

  it('shows a startup diagnostic for not-ready states with no one-click action', () => {
    const t = setup();
    t.emit({
      ready: false,
      needsOllamaInstall: false,
      missing: [],
      essentialBytes: 0,
      message: 'Local brain unavailable: Ollama timed out',
    });
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-banner')?.textContent).toMatch(/timed out/);
    expect(q('#bootstrap-download')).toBeNull();
    expect(q('#bootstrap-get-ollama')).toBeNull();
  });

  it('RECOVERS a status pushed before subscribe by fetching it on mount (the startup-race fix)', async () => {
    // Simulate the race: the push was missed (emit never called); getStatus() returns the missed status.
    const t = setup({ getStatus: vi.fn(async () => MISSING) });
    await flush();
    expect(t.getStatus).toHaveBeenCalled();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-download')).toBeTruthy(); // the banner appears despite the dropped push
  });

  it('does not let a late null startup fetch erase a visible pushed status', async () => {
    const t = setup({ getStatus: vi.fn(async () => null) });
    t.emit(MISSING);
    await flush();
    expect((q('#bootstrap-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#bootstrap-download')).toBeTruthy();
  });

  it('unmount detaches the subscription + removes the banner', () => {
    const t = setup();
    t.unmount();
    expect(q('#bootstrap-banner')).toBeNull();
  });
});
