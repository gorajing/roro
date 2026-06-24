// src/brain/eval/score.ts — the PURE scoring core of the brain eval (no model, CI-runnable).
//
// The whole local-first thesis rests on qwen2.5:3b reliably (a) picking the right DECIDE command and
// (b) honoring extractFact's null-when-unsure discipline. This scores both halves so the live runner
// (runEval.ts) can turn "is the 3B brain good enough?" into a number before we build more on it.

import type { Command } from '../../shared/brain';
import type { FactCandidate } from '../extractFact';

/** Did the brain pick the right command? (A decide() THROW — unparseable/invalid JSON — is classified
 *  'bad_json' by the runner, not here; this scores a successfully-parsed decision.) */
export function scoreDecision(expected: Command, got: Command): 'ok' | 'wrong_command' {
  return expected === got ? 'ok' : 'wrong_command';
}

/** Did the extractor honor the contract? A durable fact must be produced when expected, and the model
 *  must stay silent (null) when there's nothing durable — inventing a fact (false_fact) rots the profile. */
export function scoreExtraction(
  expected: 'fact' | 'null',
  got: FactCandidate | null,
): 'ok' | 'missed_fact' | 'false_fact' {
  if (expected === 'fact') return got !== null ? 'ok' : 'missed_fact';
  return got === null ? 'ok' : 'false_fact'; // expected null
}

export interface EvalSummary {
  total: number;
  ok: number;
  /** ok / total, or 0 when total is 0 (no divide-by-zero). */
  accuracy: number;
  /** per-failure-mode counts (incl. 'ok'), so a low score is diagnosable, not just a number. */
  byMode: Record<string, number>;
}

/** Aggregate a list of per-case outcome modes into accuracy + a breakdown. */
export function summarize(modes: string[]): EvalSummary {
  const byMode: Record<string, number> = {};
  for (const m of modes) byMode[m] = (byMode[m] ?? 0) + 1;
  const total = modes.length;
  const ok = byMode.ok ?? 0;
  return { total, ok, accuracy: total === 0 ? 0 : ok / total, byMode };
}
