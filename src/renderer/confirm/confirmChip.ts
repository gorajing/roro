// src/renderer/confirm/confirmChip.ts — the destructive-confirm chip (a body-posture surface, NOT a
// 7th avatar state). Thin DOM shell over the push/invoke handshake: MAIN pushes a confirm request,
// the chip shows the risky summary + Approve/Deny, and a click calls the dedicated confirmResolve
// invoke channel — the ONLY approval path (a spoken/typed word can never reach it). Lives outside
// #overlay; not unit-tested beyond the jsdom behavioral test (no real layout in CI).
import { getCompanion } from '../events/bridge';

export function mountConfirmChip(): () => void {
  const host = document.getElementById('app') ?? document.body;

  const chip = document.createElement('div');
  chip.id = 'confirm-chip';
  const text = document.createElement('span');
  text.id = 'confirm-text';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.id = 'confirm-approve';
  approve.textContent = 'Approve';
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.id = 'confirm-deny';
  deny.textContent = 'Deny';
  chip.append(text, approve, deny);
  host.append(chip);

  let activeRunId: string | null = null;

  function show(req: { runId: string; summary: string }): void {
    activeRunId = req.runId;
    text.textContent = `Risky: ${req.summary}. Approve?`;
    chip.classList.add('shown');
  }
  function resolve(approved: boolean): void {
    if (!activeRunId) return; // nothing pending -> ignore stray clicks
    void getCompanion()?.confirmResolve?.(activeRunId, approved);
    activeRunId = null;
    chip.classList.remove('shown');
  }

  approve.addEventListener('click', () => resolve(true));
  deny.addEventListener('click', () => resolve(false));

  const companion = getCompanion();
  const unsubs: Array<() => void> = [];
  if (companion?.onConfirmRequest) {
    unsubs.push(companion.onConfirmRequest((req) => show(req)));
  }

  return () => {
    for (const u of unsubs) u();
    chip.remove();
  };
}
