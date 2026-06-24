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
  // Examples are deliberately DISTINCT from the eval fixtures (src/brain/eval/fixtures.ts) so the eval
  // measures generalization, not memorization. They illustrate the pattern: durable preference -> fact;
  // one-off task / greeting / question / single action -> null.
  `EXAMPLES:\n` +
  `USER SAID: "I always use yarn in this project" -> {"key":"package_manager","value":"yarn"}\n` +
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
  return { key: k, value: v };
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
