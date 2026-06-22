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
  `You extract AT MOST ONE durable, reusable fact about how this developer likes to work — ` +
  `a stable preference, convention, tool choice, or project fact worth remembering across sessions. ` +
  `Ignore one-off task details. If there is no durable fact, or you are at all unsure, output exactly null.\n` +
  `Output ONLY one JSON object {"key": string, "value": string} (snake_case key, short human-readable value), or the literal null.`;

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
