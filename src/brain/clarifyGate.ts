import type { Decision, DecideInput } from '../shared/brain';
import { MEMORY_EPISODES_HEADER } from '../shared/memoryFormat';

interface ClarifyRule {
  readonly match: RegExp;
  readonly question: string;
}

const RULES: ClarifyRule[] = [
  {
    match: /^(fix|repair|debug) (it|this|that|the issue|the problem)$/,
    question: 'What should I fix, and where should I look?',
  },
  {
    match: /^(make|make it|make this|make that) better$/,
    question: 'What should I improve, and what outcome do you want?',
  },
  {
    match: /^update (it|this|that)$/,
    question: 'What should I update, and what should change?',
  },
  {
    match: /^do (that|the) thing( we talked about)?$/,
    question: 'Which thing should I do, and where should I apply it?',
  },
  {
    match: /^change (the|its|this|that)? ?color$/,
    question: 'What should change color, and what color should it become?',
  },
];

function normalizeTranscript(transcript: string): string {
  let value = transcript
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value
    .replace(/^(hey )?roro /, '')
    .replace(/^(please )?((can|could|would|will) you|can u) /, '')
    .replace(/^please /, '')
    .replace(/ please$/, '')
    .trim();

  return value;
}

/**
 * Deterministic trust guard for referent-less requests. These are not coding tasks yet: without an
 * object ("it", "that thing") Roro should ask once instead of dispatching an executor into a repo.
 */
export function clarifyForReferentlessRequest(input: DecideInput): Decision | null {
  if (input.screen?.trim()) return null;
  if (hasRelatedPastContext(input.memory)) return null;

  const normalized = normalizeTranscript(input.transcript);
  const rule = RULES.find((candidate) => candidate.match.test(normalized));
  if (!rule) return null;

  return {
    narration: rule.question,
    command: 'clarify',
    args: { question: rule.question },
  };
}

// Built from the SHARED header constant (src/shared/memoryFormat.ts) so the composer in
// src/main/memoryContext.ts and this inspector can never silently desynchronize.
const EPISODES_SECTION_PATTERN = new RegExp(
  MEMORY_EPISODES_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`\s*([\s\S]*)`,
  'i',
);

function hasRelatedPastContext(memory: string | undefined): boolean {
  if (!memory?.trim()) return false;
  const match = EPISODES_SECTION_PATTERN.exec(memory);
  return Boolean(match?.[1]?.trim());
}

export const __test = { normalizeTranscript, hasRelatedPastContext };
