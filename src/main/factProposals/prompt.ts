// src/main/factProposals/prompt.ts — the post-run proposal ask, as a PURE function of RunDigest.
//
// PRIVACY: this module must never import memory, profile, transcript, or narration sources. The
// prompt is constructible from a RunDigest literal alone (pinned by prompt.test.ts) — that is what
// makes "no new provider exposure" true by construction rather than by policy.

import type { RunDigest } from './types';

export function buildProposalPrompt(digest: RunDigest): string {
  const files = digest.files.map((f) => `${f.op} ${f.path}`);
  const section = (label: string, lines: string[]): string =>
    lines.length > 0 ? `${label}:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
  const body = [
    `TASK GIVEN TO YOU EARLIER:\n${digest.task}`,
    section('COMMANDS YOU RAN', digest.commands),
    section('FILES YOU CHANGED', files),
    section('THINGS YOU SAID', digest.messages),
    digest.finalText ? `YOUR FINAL SUMMARY:\n${digest.finalText}` : '',
  ].filter(Boolean).join('\n\n');

  return [
    'You just completed the coding run summarized below. Answer ONE question about the HUMAN you worked for:',
    'what durable preference about HOW THIS PERSON LIKES TO WORK did this run reveal, if any?',
    '',
    'Rules — read them as a skeptic:',
    '- MOST runs teach nothing durable about the person. When in doubt, output exactly: []',
    '- Never propose facts about the codebase, the task, or your own choices — only the human’s way of working.',
    '- Output a JSON array of at most 2 objects: {"key", "value", "evidence"}.',
    '- "key": short snake_case topic (e.g. "test_style").',
    '- "value": a short descriptive phrase (never a bare yes/no/true/false).',
    '- "evidence": a SHORT verbatim quote (under 120 characters) copied from the material below that proves the claim. No quote, no proposal.',
    '- Output ONLY the JSON array. No prose, no fences.',
    '',
    body,
  ].join('\n');
}
