// src/executor/abortKill.ts — escalate SIGTERM -> SIGKILL on abort.
//
// spawn({signal}) sends SIGTERM when the AbortSignal fires; a child that IGNORES SIGTERM would keep
// its stdout open, so the executor's for-await never ends and the orchestrator's single-executor slot
// is held forever (the watchdog only makes the run UI-terminal, not the slot free). This arms a grace
// timer on abort and SIGKILLs (unblockable) if the child hasn't exited — guaranteeing the slot frees.

export interface KillableChild {
  /** null while running; a number once exited. */
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  once(event: 'exit', cb: () => void): void;
}

export function armSigkillEscalation(
  child: KillableChild,
  signal: AbortSignal | undefined,
  graceMs: number,
): void {
  if (!signal) return;
  const onAbort = (): void => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL'); // still alive after SIGTERM -> force-kill
    }, graceMs);
    child.once('exit', () => clearTimeout(timer)); // exited (SIGTERM worked) -> cancel the escalation
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
}
