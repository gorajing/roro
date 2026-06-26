// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountProjectSettings } from './projectSettings';
import { WORKDIR_CONFIGURED_EVENT } from '../bootstrap/workdirSetup';
import type { WorkdirConfigMsg } from '../../shared/ipc';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (s: string): HTMLElement | null => document.querySelector(s);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

function setup(over: {
  getConfig?: ReturnType<typeof vi.fn>;
  chooseWorkdir?: ReturnType<typeof vi.fn>;
  onStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  document.body.innerHTML = '<div id="app"><div id="controls"></div></div>';
  const getConfig = over.getConfig ?? vi.fn(async (): Promise<WorkdirConfigMsg> => ({
    workdir: '/repo/one',
    source: 'config',
  }));
  const chooseWorkdir = over.chooseWorkdir ?? vi.fn(async (): Promise<WorkdirConfigMsg> => ({
    workdir: '/repo/two',
    source: 'config',
  }));
  const onStatus = over.onStatus ?? vi.fn();
  const unmount = mountProjectSettings({ getConfig, chooseWorkdir, onStatus });
  return { getConfig, chooseWorkdir, onStatus, unmount };
}

describe('mountProjectSettings - change the configured working repo', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders a closed project toggle in the controls surface', async () => {
    setup();
    await flush();
    expect(q('#controls #project-settings-toggle')).toBeTruthy();
    expect(q('#project-settings-toggle')?.textContent).toBe('Project: one');
    expect(q('#project-settings-toggle')?.getAttribute('aria-label')).toMatch('/repo/one');
    expect((q('#project-settings-panel') as HTMLElement).hidden).toBe(true);
    expect(q('#project-settings-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opening fetches and displays the current saved project', async () => {
    const t = setup();
    click(q('#project-settings-toggle'));
    await flush();
    expect(t.getConfig).toHaveBeenCalled();
    expect((q('#project-settings-panel') as HTMLElement).hidden).toBe(false);
    expect(q('#project-settings-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('#project-settings-current')?.textContent).toBe('/repo/one');
    expect(q('#project-settings-source')?.textContent).toBe('Saved project');
  });

  it('changing project invokes the native picker bridge, updates the panel, and broadcasts the shared event', async () => {
    const t = setup();
    const seen: WorkdirConfigMsg[] = [];
    window.addEventListener(WORKDIR_CONFIGURED_EVENT, (event) => {
      seen.push((event as CustomEvent<WorkdirConfigMsg>).detail);
    });

    click(q('#project-settings-toggle'));
    await flush();
    click(q('#project-settings-change'));
    await flush();

    expect(t.chooseWorkdir).toHaveBeenCalledOnce();
    expect(q('#project-settings-current')?.textContent).toBe('/repo/two');
    expect(q('#project-settings-source')?.textContent).toBe('Saved project');
    expect(seen).toEqual([{ workdir: '/repo/two', source: 'config' }]);
    expect(q('#project-settings-toggle')?.textContent).toBe('Project: two');
    expect(t.onStatus).toHaveBeenCalledWith('Project changed to two. New tasks will use it.');
  });

  it('reacts to project changes emitted by another setup surface', async () => {
    setup();
    await flush();

    window.dispatchEvent(new CustomEvent(WORKDIR_CONFIGURED_EVENT, {
      detail: { workdir: '/external/repo-three', source: 'config' },
    }));

    expect(q('#project-settings-toggle')?.textContent).toBe('Project: repo-three');
    click(q('#project-settings-toggle'));
    expect(q('#project-settings-current')?.textContent).toBe('/external/repo-three');
  });

  it('canceling the picker leaves the panel recoverable without broadcasting a fake change', async () => {
    const chooseWorkdir = vi.fn(async (): Promise<WorkdirConfigMsg> => ({ source: 'unset' }));
    const t = setup({ chooseWorkdir });
    const listener = vi.fn();
    window.addEventListener(WORKDIR_CONFIGURED_EVENT, listener);

    click(q('#project-settings-toggle'));
    await flush();
    click(q('#project-settings-change'));
    await flush();

    expect(t.chooseWorkdir).toHaveBeenCalledOnce();
    expect(q('#project-settings-current')?.textContent).toBe('No project selected');
    expect(listener).not.toHaveBeenCalled();
    expect(t.onStatus).toHaveBeenCalledWith('Project unchanged.');
  });

  it('shows an env override and explains that it cannot change the active repo', async () => {
    const chooseWorkdir = vi.fn();
    const t = setup({
      getConfig: vi.fn(async (): Promise<WorkdirConfigMsg> => ({ workdir: '/env/repo', source: 'env' })),
      chooseWorkdir,
    });

    click(q('#project-settings-toggle'));
    await flush();

    expect(q('#project-settings-source')?.textContent).toBe('RORO_WORKDIR');
    expect(q('#project-settings-toggle')?.textContent).toBe('Project: repo (env)');
    expect(q('#project-settings-change')?.getAttribute('aria-disabled')).toBe('true');
    click(q('#project-settings-change'));
    expect(chooseWorkdir).not.toHaveBeenCalled();
    expect(t.onStatus).toHaveBeenCalledWith('This launch uses RORO_WORKDIR. Unset it to use a saved project.');
  });

  it('does not open the picker while a run is active', async () => {
    const chooseWorkdir = vi.fn();
    const onStatus = vi.fn();
    document.body.innerHTML = '<div id="app"><div id="controls"></div></div>';
    mountProjectSettings({
      getConfig: async () => ({ workdir: '/repo/one', source: 'config' }),
      chooseWorkdir,
      onStatus,
      isRunActive: () => true,
    });

    click(q('#project-settings-toggle'));
    await flush();
    click(q('#project-settings-change'));

    expect(chooseWorkdir).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('Wait for the current run to finish before changing projects.');
  });

  it('fails loud-but-friendly when config cannot be read', async () => {
    setup({ getConfig: vi.fn(async () => { throw new Error('config corrupt'); }) });

    click(q('#project-settings-toggle'));
    await flush();

    expect(q('#project-settings-current')?.textContent).toMatch(/config corrupt/);
    expect(q('#project-settings-source')?.textContent).toBe('Settings unavailable');
  });

  it('fails loud and re-enables Change Project when the picker bridge rejects', async () => {
    setup({ chooseWorkdir: vi.fn(async () => { throw new Error('dialog down'); }) });

    click(q('#project-settings-toggle'));
    await flush();
    click(q('#project-settings-change'));
    await flush();

    expect(q('#project-settings-current')?.textContent).toMatch(/dialog down/);
    expect((q('#project-settings-change') as HTMLButtonElement).disabled).toBe(false);
  });

  it('unmount removes the toggle and panel', () => {
    const t = setup();
    t.unmount();
    expect(q('#project-settings-toggle')).toBeNull();
    expect(q('#project-settings-panel')).toBeNull();
  });
});
