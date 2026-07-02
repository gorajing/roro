// src/executor/formatDrift.ts — runtime tripwire for upstream CLI format drift.
//
// Both mappers skip unknown event types for forward-compat. That is the right call for additive
// upstream changes, but it converts a RENAME into silent event loss: the run still emits
// run.completed while every command/file_change vanished — the product shows an empty feed and
// memory persists a hollow "success". The c5 false-success guard cannot see this (the terminal
// event is real). This tripwire warns when a COMPLETED run mapped zero activity, which for a
// run_agent turn is far more likely to be format drift than a genuinely actionless run.

import type { ActionEvent } from '../../shared/events';

/** Event kinds that represent actual mapped activity (vs run/turn lifecycle). */
const ACTIVITY_KINDS: ReadonlySet<ActionEvent['kind']> = new Set([
  'command', 'file_change', 'tool', 'message', 'message.delta', 'reasoning',
] as ActionEvent['kind'][]);

export function isActivityEvent(kind: ActionEvent['kind']): boolean {
  return ACTIVITY_KINDS.has(kind);
}

/** A warning string when a run completed with zero mapped activity (drift suspicion), else null. */
export function silentRunWarning(activityCount: number, terminalKind: ActionEvent['kind']): string | null {
  if (terminalKind !== 'run.completed' || activityCount > 0) return null;
  return (
    '[executor] run completed with ZERO mapped activity events — possible upstream CLI format drift ' +
    '(unknown-type skipping is silent). Verify with: npx vitest run src/executor/fixtures.test.ts'
  );
}
