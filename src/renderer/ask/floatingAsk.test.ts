// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountFloatingAsk } from './floatingAsk';
import type { CharacterDriver } from '../character/types';
import type { ActionEvent } from '../../shared/events';

function setCompanion(stub: unknown): void {
  (window as unknown as { companion: unknown }).companion = stub;
}

function setup() {
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
    onActionEvent: (cb: (e: ActionEvent) => void): (() => void) => { actionCb = cb; return unsub; },
    onRunEnd: (cb: () => void): (() => void) => { runEndCb = cb; return unsub; },
    onFocusAsk: (cb: () => void): (() => void) => { focusAskCb = cb; return unsub; },
  });
  const unmount = mountFloatingAsk({ driver: driver as unknown as CharacterDriver, sessionId: 'sess' });
  return {
    driver, turnRun, cancelTask, unmount,
    form: document.getElementById('floating-ask') as HTMLElement,
    pill: document.getElementById('ask-pill') as HTMLButtonElement,
    input: document.getElementById('ask-input') as HTMLInputElement,
    stop: document.getElementById('floating-stop') as HTMLButtonElement,
    fireAction: (e: ActionEvent) => actionCb?.(e),
    fireRunEnd: () => runEndCb?.(),
    fireFocusAsk: () => focusAskCb?.(),
  };
}

const submit = (form: HTMLElement) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const started: ActionEvent = { kind: 'run.started', runId: 'r1', agent: 'codex', ts: 1 };

describe('floatingAsk shell (jsdom)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });
  afterEach(() => { h.unmount(); setCompanion(undefined); });

  it('starts collapsed', () => {
    expect(h.form.classList.contains('collapsed')).toBe(true);
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

  it('non-empty submit → tasked, sets the thinking pose, calls turnRun (trimmed)', () => {
    h.pill.click();
    h.input.value = '  add a logout route  ';
    submit(h.form);
    expect(h.form.classList.contains('tasked')).toBe(true);
    expect(h.driver.setState).toHaveBeenCalledWith('thinking');
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
    await new Promise((r) => setTimeout(r)); // flush the .catch
    expect(h.form.classList.contains('collapsed')).toBe(true);
  });
});
