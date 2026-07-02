// src/brain/eval/score.ts — the PURE scoring core of the brain eval (no model, CI-runnable).
//
// The whole local-first thesis rests on qwen2.5:3b reliably (a) picking the right DECIDE command and
// (b) honoring extractFact's null-when-unsure discipline. This scores both halves so the live runner
// (runEval.ts) can turn "is the 3B brain good enough?" into a number before we build more on it.

import type { Command } from '../../../shared/brain';
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

/** The descriptive-value contract for a behavioral-preference fixture (only meaningful for expect:'fact').
 *  mustContainOneOf: the value must mention at least one of these (on-topic); minWords: a floor on length.
 *
 *  POLARITY GUARDS — a topic token alone is direction-blind: "force pushes to shared branches" contains
 *  'force'+'push' yet states the OPPOSITE of "we never force push" — an INVERTED memory, worse for the
 *  user than a missed one. Two conjunctive guards close that gap (both use the same whole-word-START
 *  matcher; violating either scores the distinct mode 'inverted', never buried in off_topic):
 *  - mustAlsoContainOneOf: the value must ADDITIONALLY carry one of these direction-carrying tokens
 *    (e.g. 'never'/'not'/'avoid' for a negated habit) — topic present but direction absent → inverted.
 *    A multi-word token can encode word ORDER ('over mysql' matches the correct "postgres over mysql"
 *    but not the inverted "mysql over postgres") — use this where the model's natural correct form is
 *    a comparison echo (observed live at temp 0), which a bare alternative-ban would false-flag.
 *  - mustNotContainAnyOf: the value must NOT mention any of these (the disfavored alternative, e.g.
 *    'jest' when vitest is the rule). Deliberately trades a rare false-inverted on an echoing-but-
 *    correct value ("vitest, never jest") for NEVER scoring a wrong-direction value ok — the safe
 *    direction; a false 'inverted' is visible and prompts a human read, a false 'ok' hides the P1. */
export interface ValueContract {
  mustContainOneOf?: string[];
  mustAlsoContainOneOf?: string[];
  mustNotContainAnyOf?: string[];
  minWords?: number;
}

/** Whole-word-START match (NOT substring): the token must begin at a word boundary, but may continue — so
 *  'lint' matches 'linter', 'test' matches 'tests', but 'test' does NOT match 'latest' and 'review' does NOT
 *  match 'preview'. Avoids the substring-anywhere looseness (a short token like 'pr' matching 'prefers')
 *  while still allowing natural inflections. Multi-word tokens ('change log') match as a boundary-started phrase. */
function matchesToken(value: string, token: string): boolean {
  const escaped = token.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'i').test(value);
}

/** A SECOND, additive axis (separate from scoreExtraction's detection): is the extracted VALUE actually a
 *  usable recalled-memory line, or noise? null→missed_fact; below minWords→too_thin; off the topic→off_topic;
 *  on-topic but direction-flipped (polarity guard violated)→inverted; else ok. NOTE: a bare-boolean value
 *  (value:"true") never reaches this on the LIVE path — the runtime guard (isUselessValue in extractFact.ts)
 *  converts it to null FIRST, so it scores 'missed_fact' (the user's true outcome: no recalled memory).
 *  This axis therefore measures the user-facing usable-value rate. */
export function scoreFactValue(
  contract: ValueContract | undefined,
  got: FactCandidate | null,
): 'ok' | 'missed_fact' | 'too_thin' | 'off_topic' | 'inverted' {
  if (got === null) return 'missed_fact';
  const value = got.value.trim();
  const c = contract ?? {};
  if (c.minWords !== undefined && value.split(/\s+/).filter(Boolean).length < c.minWords) return 'too_thin';
  if (c.mustContainOneOf && c.mustContainOneOf.length > 0) {
    if (!c.mustContainOneOf.some((t) => matchesToken(value, t))) return 'off_topic';
  }
  // Polarity, checked only AFTER the topic matched: an inverted value is on-topic by definition —
  // 'inverted' stays distinct so the failure mode is visible (the eval-metric-DOA lesson), because an
  // inverted memory recalled to the user is WORSE than a missed one.
  if (c.mustNotContainAnyOf && c.mustNotContainAnyOf.some((t) => matchesToken(value, t))) return 'inverted';
  if (c.mustAlsoContainOneOf && c.mustAlsoContainOneOf.length > 0) {
    if (!c.mustAlsoContainOneOf.some((t) => matchesToken(value, t))) return 'inverted';
  }
  return 'ok';
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
