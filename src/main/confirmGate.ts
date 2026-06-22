// src/main/confirmGate.ts — the MAIN-side destructive-confirm handshake (NOT an ActionEvent kind).
//
// Flow: the orchestrator calls requestConfirm(runId, summary, push) BEFORE dispatching a destructive
// task. It pushes CH.confirmRequest to the renderer (which shows a confirm chip) and awaits the
// user's dedicated CH.confirmResolve, routed here via resolveConfirm. A 15s timeout DEFAULT-DENIES,
// so a turn left unanswered never runs. Approval can ONLY come from resolveConfirm (the dedicated
// invoke channel) — never from a spoken/typed transcript.

export type ConfirmPush = (req: { runId: string; summary: string }) => void;

interface Pending {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 15_000;

/** Ask the user to approve a destructive run. Resolves true (approved) / false (denied or timed out). */
export function requestConfirm(
  runId: string,
  summary: string,
  push: ConfirmPush,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  push({ runId, summary });
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(runId);
      resolve(false); // default-DENY on timeout
    }, timeoutMs);
    pending.set(runId, { resolve, timer });
  });
}

/** Resolve a pending confirm from the renderer's dedicated CH.confirmResolve. Unknown id -> no-op. */
export function resolveConfirm(runId: string, approved: boolean): void {
  const p = pending.get(runId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(runId);
  p.resolve(approved);
}
