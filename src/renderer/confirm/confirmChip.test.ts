// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountConfirmChip } from './confirmChip';

function setCompanion(stub: unknown): void {
  (window as unknown as { companion: unknown }).companion = stub;
}

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  let reqCb: ((req: { runId: string; summary: string }) => void) | null = null;
  let runEndCb: ((p: { runId: string }) => void) | null = null;
  const confirmResolve = vi.fn().mockResolvedValue(undefined);
  const unsub = (): void => undefined;
  setCompanion({
    confirmResolve,
    onConfirmRequest: (cb: (req: { runId: string; summary: string }) => void): (() => void) => { reqCb = cb; return unsub; },
    onRunEnd: (cb: (p: { runId: string }) => void): (() => void) => { runEndCb = cb; return unsub; },
  });
  const unmount = mountConfirmChip();
  return {
    confirmResolve, unmount,
    chip: document.getElementById('confirm-chip') as HTMLElement,
    text: document.getElementById('confirm-text') as HTMLElement,
    approve: document.getElementById('confirm-approve') as HTMLButtonElement,
    deny: document.getElementById('confirm-deny') as HTMLButtonElement,
    fireRequest: (req: { runId: string; summary: string }) => reqCb?.(req),
    fireRunEnd: (runId: string) => runEndCb?.({ runId }),
  };
}

describe('confirmChip (jsdom)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });
  afterEach(() => { h.unmount(); setCompanion(undefined); });

  it('starts hidden, no pending request', () => {
    expect(h.chip.classList.contains('shown')).toBe(false);
    h.approve.click();
    expect(h.confirmResolve).not.toHaveBeenCalled(); // a stray click with nothing pending is ignored
  });

  it('shows the risky summary on a confirm request', () => {
    h.fireRequest({ runId: 'r1', summary: 'recursive file deletion (rm -r)' });
    expect(h.chip.classList.contains('shown')).toBe(true);
    expect(h.text.textContent).toContain('recursive file deletion (rm -r)');
  });

  it('Approve resolves the dedicated channel with true, then hides', () => {
    h.fireRequest({ runId: 'r1', summary: 's' });
    h.approve.click();
    expect(h.confirmResolve).toHaveBeenCalledWith('r1', true);
    expect(h.chip.classList.contains('shown')).toBe(false);
  });

  it('Deny resolves with false', () => {
    h.fireRequest({ runId: 'r2', summary: 's' });
    h.deny.click();
    expect(h.confirmResolve).toHaveBeenCalledWith('r2', false);
  });

  it('dismisses when the request\'s turn ends (15s timeout default-deny -> runEnd)', () => {
    h.fireRequest({ runId: 'r3', summary: 's' });
    expect(h.chip.classList.contains('shown')).toBe(true);
    h.fireRunEnd('r3');
    expect(h.chip.classList.contains('shown')).toBe(false);
    // a later click after dismissal is a no-op (no double-resolve)
    h.approve.click();
    expect(h.confirmResolve).not.toHaveBeenCalled();
  });
});
