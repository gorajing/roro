// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWorkdirBanner } from './workdirBanner';
import { WORKDIR_CONFIGURED_EVENT } from './workdirSetup';
import type { WorkdirConfigMsg } from '../../shared/ipc';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (s: string): HTMLElement | null => document.querySelector(s);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

function setup(over: {
  getConfig?: ReturnType<typeof vi.fn>;
  chooseWorkdir?: ReturnType<typeof vi.fn>;
  onStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const getConfig = over.getConfig ?? vi.fn(async (): Promise<WorkdirConfigMsg> => ({ source: 'unset' }));
  const chooseWorkdir = over.chooseWorkdir ?? vi.fn(async (): Promise<WorkdirConfigMsg> => ({ workdir: '/repo', source: 'config' }));
  const onStatus = over.onStatus ?? vi.fn();
  const unmount = mountWorkdirBanner({ getConfig, chooseWorkdir, onStatus });
  return { getConfig, chooseWorkdir, onStatus, unmount };
}

describe('mountWorkdirBanner — first-run project picker', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows a Choose Project action when no working repo is configured', async () => {
    setup();
    await flush();
    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#workdir-choose')).toBeTruthy();
    expect(q('#workdir-text')?.getAttribute('role')).toBe('status');
    expect(q('#workdir-text')?.getAttribute('aria-live')).toBe('polite');
    expect(q('#workdir-choose')?.getAttribute('aria-describedby')).toBe('workdir-text');
  });

  it('stays hidden when a workdir is already configured', async () => {
    setup({ getConfig: vi.fn(async () => ({ workdir: '/repo', source: 'config' })) });
    await flush();
    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(true);
  });

  it('clicking Choose Project calls the native picker bridge and hides once configured', async () => {
    const t = setup();
    await flush();
    click(q('#workdir-choose'));
    await flush();
    expect(t.chooseWorkdir).toHaveBeenCalledTimes(1);
    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(true);
    expect(t.onStatus).toHaveBeenCalledWith('Project selected — Roro can run coding tasks.');
  });

  it('hides when project setup completes through another dispatch path', async () => {
    setup();
    await flush();
    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(false);

    window.dispatchEvent(new CustomEvent(WORKDIR_CONFIGURED_EVENT, {
      detail: { workdir: '/chosen/repo', source: 'config' },
    }));

    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(true);
  });

  it('canceling the picker leaves the banner visible', async () => {
    setup({ chooseWorkdir: vi.fn(async () => ({ source: 'unset' })) });
    await flush();
    click(q('#workdir-choose'));
    await flush();
    expect((q('#workdir-banner') as HTMLElement).hidden).toBe(false);
    expect(q('#workdir-banner')?.textContent).toMatch(/choose/i);
  });

  it('fails loud and re-enables the button when the picker bridge rejects', async () => {
    setup({ chooseWorkdir: vi.fn(async () => { throw new Error('dialog failed'); }) });
    await flush();
    click(q('#workdir-choose'));
    await flush();
    expect(q('#workdir-banner')?.textContent).toMatch(/dialog failed/);
    expect((q('#workdir-choose') as HTMLButtonElement).disabled).toBe(false);
  });
});
