// src/brain/extractFact.ts — pure prompt + parser for the thin 1-fact-per-turn extractor.
// CONSERVATIVE BY DESIGN: any doubt -> null (write no row). A silent cat beats a wrong one.

export interface FactExtractInput {
  transcript: string;
  narration: string;
  task?: string;
  outcome: 'completed' | 'failed' | 'answered';
}

export interface FactCandidate {
  key: string;
  value: string;
}

export const FACT_SYSTEM_PROMPT =
  `You extract AT MOST ONE durable, reusable fact about how this developer likes to work — a STABLE ` +
  `preference, convention, tool choice, or project fact worth remembering across sessions.\n` +
  `MOST turns have NO durable fact. A one-off coding task, a question, a greeting, a thank-you, or a ` +
  `single action is NOT a durable fact — for those you MUST output exactly: null. When in ANY doubt, ` +
  `output null. A missed fact is harmless; a WRONG fact poisons the developer's profile.\n` +
  `Output ONLY one JSON object {"key": string, "value": string} (snake_case key, short human-readable ` +
  `value), OR the literal null. No prose, no markdown.\n` +
  // The recalled memory line shows the VALUE verbatim, so a bare "true" surfaces as a useless "- true".
  // Force a descriptive value, especially for behavioral habits (the 3B model otherwise boolean-izes them).
  // NB: these examples are kept DISJOINT from the eval's behavioral fixtures (src/brain/eval) so the eval
  // measures generalization, not memorization (enforced by fixtures.test.ts).
  `The value is a short, self-contained description a human could read back — e.g. "uses pnpm", ` +
  `"2-space indentation", "rebases branches before merging". It is NEVER a bare boolean or yes/no ` +
  `("true", "false", "yes", "no") and NEVER just a flag: for a HABIT, describe WHAT the developer does ` +
  `("documents public functions with JSDoc"), not THAT they do it ("true").\n` +
  // Examples are deliberately DISTINCT from the eval fixtures (src/brain/eval/fixtures.ts) so the eval
  // measures generalization, not memorization. They illustrate the pattern: durable preference -> fact;
  // one-off task / greeting / question / single action -> null.
  `EXAMPLES:\n` +
  `USER SAID: "I always use yarn in this project" -> {"key":"package_manager","value":"yarn"}\n` +
  // One BEHAVIORAL example (habit -> descriptive value, not a boolean) — the failure mode observed live.
  `USER SAID: "I always squash my commits before merging" -> {"key":"merge_style","value":"squashes commits before merging"}\n` +
  `USER SAID: "rename getUser to fetchUser" -> null\n` +
  `USER SAID: "hey there" -> null\n` +
  `USER SAID: "how do I reverse a list in python" -> null\n` +
  `USER SAID: "I prefer 4-space indentation everywhere" -> {"key":"indentation","value":"4 spaces"}\n` +
  `USER SAID: "open the config file" -> null`;

// The local 3B model has NO null-discipline: it invents a "fact" from every turn, even with few-shot null
// examples (measured — src/brain/eval). Since "a missed fact is harmless but a WRONG fact poisons the
// profile", we don't trust the model to stay silent — we GATE it: only consult the model when the transcript
// actually reads like a STATED preference/convention. Deterministic, conservative, biased toward null.
// Known limit: a preference stated WITHOUT this language is missed (the safe direction); grow the markers
// from real RORO_TRACE captures. A task that happens to contain "always" can still slip through to the model.
const PREFERENCE_MARKERS = [
  'always',
  'never',
  'prefer',
  'usually',
  'by default',
  'from now on',
  'going forward',
  'i like',
  'i use',
  'we use',
  'we always',
  'our convention',
  'stick to',
  'convention',
  'in this project',
  'in this repo',
  'in this codebase',
];

/** True when the transcript reads like a stated, durable preference/convention worth asking the model about.
 *  A one-off task, question, or greeting has no such language → false → extract nothing (don't trust the
 *  model to output null). Pure + conservative. */
export function isPlausiblePreference(input: FactExtractInput): boolean {
  const t = input.transcript.toLowerCase();
  return PREFERENCE_MARKERS.some((m) => t.includes(m));
}

export function buildFactPrompt(input: FactExtractInput): string {
  return [
    `OUTCOME: ${input.outcome}`,
    `USER SAID: ${JSON.stringify(input.transcript)}`,
    input.task ? `TASK: ${JSON.stringify(input.task)}` : '',
    `RORO SAID: ${JSON.stringify(input.narration)}`,
    `Extract one durable fact as {"key","value"}, or output null if there is no durable fact or you are unsure.`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

export function parseFactResponse(raw: string): FactCandidate | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (/^null$/i.test(withoutFence)) return null;

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const key = (parsed as Record<string, unknown>).key;
  const value = (parsed as Record<string, unknown>).value;
  if (typeof key !== 'string' || typeof value !== 'string') return null;
  // Canonicalize the key to snake_case: supersede matching is exact-key, so "Pkg_Manager" /
  // "pkg-manager" must collapse to "pkg_manager" or they'd shadow rather than replace each other.
  const k = normalizeKey(key);
  const v = value.trim();
  if (!k || !v) return null;
  if (isUselessValue(v)) return null; // bare boolean / yes-no / placeholder → null (renders as a noise line)
  return { key: k, value: v };
}

/** Exported for the executor-proposal channel (src/main/factProposals) — ONE normalizer, so
 *  supersede matching can never diverge between the 3B and executor channels. */
export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Bare boolean / yes-no / placeholder values are USELESS as a recalled memory line: recall renders the
// VALUE verbatim ("- ${value}"), so value:"true" surfaces as the noise line "- true" (the 3B model
// collapses behavioral habits to this — observed live). Reject them → null (the safe direction: a missed
// fact is harmless, a wrong one poisons the profile). A CLOSED allowlist-of-garbage matched by WHOLE-STRING
// equality on the trimmed+lowercased value — so "no" is rejected but "no semicolons" / "node 20" / "1 space"
// are kept (no legitimate preference value is a single bare boolean/placeholder token). This is the ONLY
// copy of the set: the eval (src/brain/eval/score.ts) deliberately does NOT re-check it — the guard nulls
// garbage before the eval could see it, so the eval scores the honest downstream outcome (missed_fact).
const USELESS_VALUES = new Set([
  'true', 'false', 'yes', 'no', 'y', 'n',
  'n/a', 'na', 'none', 'null', 'nil', 'undefined', '0', '1',
]);
/** Exported for the executor-proposal channel — ONE garbage-value guard across both channels. */
export function isUselessValue(value: string): boolean {
  return USELESS_VALUES.has(value.trim().toLowerCase());
}
