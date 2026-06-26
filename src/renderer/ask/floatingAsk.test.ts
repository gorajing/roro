// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountFloatingAsk } from './floatingAsk';
import type { CharacterDriver } from '../character/types';
import type { ActionEvent } from '../../shared/events';

function setCompanion(stub: unknown): void {
  (window as unknown as { companion: unknown }).companion = stub;
}

function setup(over: {
  getWorkdirConfig?: ReturnType<typeof vi.fn>;
  chooseWorkdir?: ReturnType<typeof vi.fn>;
  canStartTurn?: ReturnType<typeof vi.fn>;
  smokeLifecycle?: boolean;
} = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const driver = { poke: vi.fn(), setState: vi.fn() };
  let actionCb: ((e: ActionEvent) => void) | null = null;
  let runEndCb: (() => void) | null = null;
  let focusAskCb: (() => void) | null = null;
  const turnRun = vi.fn().mockResolvedValue({ runId: 'r1' });
  const cancelTask = vi.fn().mockResolvedValue(undefined);
  const unsub = (): void => undefined;
  setCompanion({
    turnRun,
    cancelTask,
    ...(over.getWorkdirConfig ? { getWorkdirConfig: over.getWorkdirConfig } : {}),
    ...(over.chooseWorkdir ? { chooseWorkdir: over.chooseWorkdir } : {}),
    onActionEvent: (cb: (e: ActionEvent) => void): (() => void) => { actionCb = cb; return unsub; },
    onRunEnd: (cb: () => void): (() => void) => { runEndCb = cb; return unsub; },
    onFocusAsk: (cb: () => void): (() => void) => { focusAskCb = cb; return unsub; },
  });
  const unmount = mountFloatingAsk({
    driver: driver as unknown as CharacterDriver,
    sessionId: 'sess',
    canStartTurn: over.canStartTurn,
    smokeLifecycle: over.smokeLifecycle,
  });
  return {
    driver, turnRun, cancelTask, unmount,
    form: document.getElementById('floating-ask') as HTMLElement,
    pill: document.getElementById('ask-pill') as HTMLButtonElement,
    input: document.getElementById('ask-input') as HTMLInputElement,
    stop: document.getElementById('floating-stop') as HTMLButtonElement,
    error: document.getElementById('floating-error') as HTMLElement,
    fireAction: (e: ActionEvent) => actionCb?.(e),
    fireRunEnd: () => runEndCb?.(),
    fireFocusAsk: () => focusAskCb?.(),
  };
}

const submit = (form: HTMLElement) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const started: ActionEvent = { kind: 'run.started', runId: 'r1', agent: 'codex', ts: 1 };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r));
const smokeHook = () => (
  window as unknown as {
    __roroFloatingAskSmoke?: {
      startTask(text: string): void;
      action(e: ActionEvent): void;
      runEnd(): void;
      state(): { cancelRequests: Array<string | undefined> };
    };
  }
).__roroFloatingAskSmoke;

describe('floatingAsk shell (jsdom)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });
  afterEach(() => { h.unmount(); setCompanion(undefined); });

  it('starts collapsed', () => {
    expect(h.form.classList.contains('collapsed')).toBe(true);
    expect(smokeHook()).toBeUndefined();
  });

  it('summon (pill click) expands and pokes the cat', () => {
    h.pill.click();
    expect(h.form.classList.contains('expanded')).toBe(true);
    expect(h.driver.poke).toHaveBeenCalledTimes(1);
  });

  it('onFocusAsk (⌘⇧Space) also expands', () => {
    h.fireFocusAsk();
    expect(h.form.classList.contains('expanded')).toBe(true);
  });

  it('empty Enter is a no-op: stays expanded, no pose, no turnRun', () => {
    h.pill.click();
    h.driver.setState.mockClear();
    h.input.value = '   ';
    submit(h.form);
    expect(h.form.classList.contains('expanded')).toBe(true);
    expect(h.turnRun).not.toHaveBeenCalled();
    expect(h.driver.setState).not.toHaveBeenCalled();
  });

  it('non-empty submit → tasked, sets the thinking pose, calls turnRun (trimmed)', async () => {
    h.pill.click();
    h.input.value = '  add a logout route  ';
    submit(h.form);
    expect(h.form.classList.contains('tasked')).toBe(true);
    expect(h.driver.setState).toHaveBeenCalledWith('thinking');
    await flush();
    expect(h.turnRun).toHaveBeenCalledWith({ transcript: 'add a logout route', sessionId: 'sess' });
  });

  it('run.started arms the Stop pill; the universal runEnd collapses the Ask', () => {
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    h.fireAction(started);
    expect(h.stop.classList.contains('armed')).toBe(true);
    h.fireRunEnd();
    expect(h.form.classList.contains('collapsed')).toBe(true);
    expect(h.stop.classList.contains('armed')).toBe(false);
  });

  it('keeps actionable failure copy visible after runEnd collapses the Ask', () => {
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    h.fireAction(started);
    h.fireAction({ kind: 'run.failed', runId: 'r1', ok: false, error: 'spawn codex ENOENT', ts: 2 });
    h.fireRunEnd();
    expect(h.form.classList.contains('collapsed')).toBe(true);
    expect(h.error.hidden).toBe(false);
    expect(h.error.textContent).toContain('Task hit a problem');
    expect(h.error.textContent).toContain('Codex CLI not found');
    expect(h.error.textContent).toContain('RORO_CODEX_BIN');
    expect(h.error.textContent).not.toContain('Turn failed');
    expect(h.error.textContent).not.toContain('spawn codex ENOENT');
  });

  it('clears the previous failure when the user summons Ask again', () => {
    h.fireAction({ kind: 'run.failed', runId: 'r1', ok: false, error: 'spawn codex ENOENT', ts: 2 });
    expect(h.error.hidden).toBe(false);
    h.pill.click();
    expect(h.error.hidden).toBe(true);
  });

  it('Stop click cancels by the captured runId', () => {
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    h.fireAction(started);
    h.stop.click();
    expect(h.cancelTask).toHaveBeenCalledWith('r1');
  });

  it('recovers from a rejected turnRun (never stuck in tasked)', async () => {
    h.turnRun.mockRejectedValueOnce(new Error('ipc down'));
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    expect(h.form.classList.contains('tasked')).toBe(true);
    await flush(); // flush the .catch
    expect(h.form.classList.contains('collapsed')).toBe(true);
  });

  it('opens project setup before dispatch when the workdir is unset', async () => {
    h.unmount();
    const getWorkdirConfig = vi.fn(async () => ({ source: 'unset' as const }));
    const chooseWorkdir = vi.fn(async () => ({ workdir: '/chosen/repo', source: 'config' as const }));
    h = setup({ getWorkdirConfig, chooseWorkdir });
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    await flush();
    expect(chooseWorkdir).toHaveBeenCalledTimes(1);
    expect(h.turnRun).toHaveBeenCalledWith({ transcript: 'do it', sessionId: 'sess' });
  });

  it('keeps the draft expanded without dispatch when project setup is canceled', async () => {
    h.unmount();
    const getWorkdirConfig = vi.fn(async () => ({ source: 'unset' as const }));
    const chooseWorkdir = vi.fn(async () => ({ source: 'unset' as const }));
    h = setup({ getWorkdirConfig, chooseWorkdir });
    h.pill.click();
    h.input.value = 'do it';
    submit(h.form);
    await flush();
    expect(h.turnRun).not.toHaveBeenCalled();
    expect(h.form.classList.contains('expanded')).toBe(true);
    expect(h.input.value).toBe('do it');
  });

  it('keeps the draft expanded without dispatch when the local brain is not ready', async () => {
    h.unmount();
    const getWorkdirConfig = vi.fn(async () => ({ workdir: '/chosen/repo', source: 'config' as const }));
    const canStartTurn = vi.fn(() => false);
    h = setup({ getWorkdirConfig, canStartTurn });
    h.pill.click();
    h.driver.setState.mockClear();
    h.input.value = 'do it';
    submit(h.form);
    await flush();
    expect(canStartTurn).toHaveBeenCalledTimes(1);
    expect(h.turnRun).not.toHaveBeenCalled();
    expect(h.driver.setState).not.toHaveBeenCalled();
    expect(h.form.classList.contains('expanded')).toBe(true);
    expect(h.input.value).toBe('do it');
    expect(h.stop.classList.contains('armed')).toBe(false);
  });

  it('exposes a gated smoke harness that drives the same lifecycle handlers', () => {
    h.unmount();
    h = setup({ smokeLifecycle: true });
    expect(smokeHook()).toBeDefined();

    h.pill.click();
    smokeHook()?.startTask('  add a logout route  ');
    expect(h.form.classList.contains('tasked')).toBe(true);
    expect(h.pill.textContent).toBe('tasked: add a logout route');

    smokeHook()?.action(started);
    expect(h.stop.classList.contains('armed')).toBe(true);
    h.stop.click();
    expect(smokeHook()?.state().cancelRequests).toEqual(['r1']);

    smokeHook()?.action({ kind: 'run.failed', runId: 'r1', ok: false, error: 'spawn codex ENOENT', ts: 2 });
    expect(h.stop.classList.contains('armed')).toBe(false);
    expect(h.error.textContent).toContain('Task hit a problem');

    smokeHook()?.runEnd();
    expect(h.form.classList.contains('collapsed')).toBe(true);
    expect(h.error.hidden).toBe(false);

    h.unmount();
    expect(smokeHook()).toBeUndefined();
  });
});
