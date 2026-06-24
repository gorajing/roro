// src/executor/exitAccounting.ts — decide an executor's terminal event when its JSONL stream ends WITHOUT one.
//
// The coding-agent CLIs (codex/claude) emit a terminal event on BOTH success (turn.completed / result:success
// → run.completed) and failure (→ run.failed). So a stream that ends with NO terminal is abnormal — the child
// crashed, was killed, or exited nonzero without a result. Reporting that as success is the c5 bug: the
// orchestrator would synthesize a fabricated run.completed AND persist outcome:'completed' to memory. This
// makes the adapter fail loud (with the exit code + a stderr tail) instead. Pure → unit-tested.

import type { ActionEvent } from '../shared/events';

export interface ExitContext {
  runId: string;
  /** 'codex' | 'claude' — for the error message. */
  bin: string;
  /** Did the JSONL stream already yield a run.completed / run.failed? */
  emittedTerminal: boolean;
  /** Was the run aborted (Stop / barge-in)? Already accounted for upstream. */
  aborted: boolean;
  /** Did the child fail to spawn (ENOENT)? Already accounted for upstream. */
  spawnError: boolean;
  /** The child's exit code (null if killed by signal or unknown). */
  code: number | null;
  /** The terminating signal, if the child was killed. */
  signal: NodeJS.Signals | null;
  /** The tail of the child's stderr (logs/diagnostics) — surfaced in the failure message. */
  stderrTail: string;
}

/**
 * The terminal event to yield AFTER the stream ends with none — or null if the situation is already handled
 * (a terminal was emitted, aborted, or a spawn error) or the exit was clean (code 0; the orchestrator's own
 * fallback decides that case). A nonzero/killed exit is a failure and must never read as success.
 */
export function finalTerminalEvent(ctx: ExitContext, ts: number): ActionEvent | null {
  if (ctx.emittedTerminal || ctx.aborted || ctx.spawnError) return null;
  if (ctx.code !== 0 || ctx.signal != null) {
    const how = ctx.signal ? `on signal ${ctx.signal}` : `with code ${ctx.code}`;
    const tail = ctx.stderrTail.trim();
    return {
      kind: 'run.failed',
      runId: ctx.runId,
      ok: false,
      error: `${ctx.bin} exited ${how} without a result${tail ? `: ${tail.slice(-300)}` : ''}`,
      ts,
    };
  }
  return null; // clean exit (code 0), no terminal — the orchestrator now fails loud on this too
}
