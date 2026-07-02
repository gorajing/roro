// src/main/factProposals/admission.ts — the deterministic gate for executor-proposed facts.
//
// The executor channel's analogue of isPlausiblePreference (which gates USER transcripts): a
// proposal is admitted only when it can PROVE itself against the run — its `evidence` must be a
// verbatim quote from the digest. Cost asymmetry governs every rule here: a dropped-true proposal
// costs nothing (the 3B channel and the user's own words still exist); a wrong one shown to the
// user costs a dismissive click; and NOTHING here stores — admission only decides what the user is
// SHOWN. The user's Save is the only path to durable state.

import { isUselessValue, normalizeKey } from '../../brain/extractFact';
import type { AdmittedProposal, RawProposal, RunDigest } from './types';

export const MAX_ADMITTED_PER_RUN = 2; // confirm fatigue is this channel's poison mode
const MIN_EVIDENCE_CHARS = 12; // a trivial quote ("the repo") grounds nothing
export const MAX_EVIDENCE_CHARS = 140; // rendered in the panel + stored durably in payload.source — bounded here
const MIN_VALUE_CHARS = 3;
const MAX_VALUE_CHARS = 120;
const MIN_KEY_CHARS = 2;
const MAX_KEY_CHARS = 64;

/** Values that look like credentials/tokens must never become a fact row, even user-confirmed:
 *  recall would re-surface them into DECIDE prompts forever. Shape-based, deliberately broad. */
const SECRET_SHAPE = /(api[_-]?key|token|secret|password|bearer\s)|[A-Za-z0-9+/_-]{24,}/i;

/** Whitespace/case-normalize for verbatim-substring grounding. */
const canon = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Strict, never-throwing parse: fence-strip, JSON array only, per-element salvage. */
export function parseProposals(raw: string): RawProposal[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RawProposal[] = [];
  for (const el of parsed) {
    if (typeof el !== 'object' || el === null) continue;
    const { key, value, evidence } = el as Record<string, unknown>;
    if (typeof key !== 'string' || typeof value !== 'string' || typeof evidence !== 'string') continue;
    out.push({ key, value, evidence });
  }
  return out;
}

export interface AdmissionInput {
  digest: RunDigest;
  /** Active profile (key,value) pairs for dedupe; null = memory unavailable (admit without dedupe —
   *  dedupe is an optimization; the user's confirm is the real gate). */
  existing: { key: string; value: string }[] | null;
}

export function admitProposals(raw: RawProposal[], input: AdmissionInput): AdmittedProposal[] {
  const { digest, existing } = input;
  const haystack = canon(
    [digest.task, digest.finalText ?? '', ...digest.messages, ...digest.commands].join('\n'),
  );
  const activeByKey = new Map((existing ?? []).map((f) => [normalizeKey(f.key), canon(f.value)]));

  const out: AdmittedProposal[] = [];
  for (const p of raw) {
    if (out.length >= MAX_ADMITTED_PER_RUN) break;
    const normalizedKey = normalizeKey(p.key);
    const value = p.value.trim();
    const evidence = canon(p.evidence);
    if (normalizedKey.length < MIN_KEY_CHARS || normalizedKey.length > MAX_KEY_CHARS) continue;
    if (value.length < MIN_VALUE_CHARS || value.length > MAX_VALUE_CHARS) continue;
    if (isUselessValue(value)) continue; // bare booleans/placeholders — shared guard, single source
    if (SECRET_SHAPE.test(value)) continue;
    if (evidence.length < MIN_EVIDENCE_CHARS) continue;
    if (p.evidence.trim().length > MAX_EVIDENCE_CHARS) continue; // the ≤140 contract: reject, never truncate (verbatim stays verbatim)
    if (!haystack.includes(evidence)) continue; // THE grounding receipt: unproven → dropped
    // Exact (key,value) duplicate of an active fact adds nothing; a same-key DIFFERENT value is a
    // legitimate supersede candidate — admitted, the user's confirm decides.
    if (activeByKey.get(normalizedKey) === canon(value)) continue;
    out.push({ key: p.key, value, evidence: p.evidence.trim(), normalizedKey });
  }
  return out;
}
