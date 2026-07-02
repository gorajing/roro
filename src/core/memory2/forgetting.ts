// src/memory2/forgetting.ts — lazy, read-time decay (the "forgetting" half of the confidence loop).
//
// Key boundary (Codex design review): the FILE stores observed evidence (confidence); RETRIEVAL strength
// is computed at read time as evidence × time-decay. We never rewrite stored confidence on a timer (that
// would churn the manifest + disturb seq ordering); getProfile sorts by effectiveConfidence instead. Only
// FACTS decay in confidence — episodes are bounded by pruneEpisodes (corpus cap), core is permanent.
// Decay anchors on lastAccessedAt ?? createdAt (Generative Agents: used memories stay hot), half-life by
// ttlPolicy. (Episode recency→last-access exp-decay in the recall blend is a tracked follow-up.)

import type { Entry } from './types';

const MS_PER_DAY = 86_400_000;
const DEFAULT_FACT_HALFLIFE_DAYS = 180;
// Episode recall recency half-life (days): the research note's exp(-ageDays/30). Anchored on last-access
// so a re-surfaced memory stays hot (Generative Agents); seq remains the deterministic tiebreak.
const EPISODE_RECENCY_HALFLIFE_DAYS = 30;
// Confidence half-life (days) by fact ttlPolicy; Infinity = no decay.
const FACT_HALFLIFE_DAYS: Record<string, number> = {
  stable: Infinity, // identity-level prefs — durable until superseded
  project: 90,
  transient: 21,
};

/** Confidence half-life in days for an entry. Infinity (no decay) for core + non-fact tiers; facts use
 *  their ttlPolicy bucket, else the default. */
export function halfLifeDays(entry: Entry): number {
  if (entry.tier !== 'fact') return Infinity; // only facts decay confidence
  if (entry.ttlPolicy && entry.ttlPolicy in FACT_HALFLIFE_DAYS) return FACT_HALFLIFE_DAYS[entry.ttlPolicy];
  return DEFAULT_FACT_HALFLIFE_DAYS;
}

/** Time-decayed recency score in [0,1] at `now` (ms epoch): 2^(-age/halfLife), anchored on
 *  lastAccessedAt ?? createdAt. ABSOLUTE (not normalized over the candidate set) so genuinely-old
 *  episodes score low even when they're the freshest in a stale batch — the forgetting signal. The
 *  top-2 recency guarantee (in recall) still protects the "what did we just do?" path. */
export function effectiveRecency(entry: Entry, now: number): number {
  const anchorMs = Date.parse(entry.lastAccessedAt ?? entry.createdAt);
  if (Number.isNaN(anchorMs)) return 0;
  const ageDays = Math.max(0, (now - anchorMs) / MS_PER_DAY);
  return Math.pow(2, -ageDays / EPISODE_RECENCY_HALFLIFE_DAYS);
}

/** Effective (decayed) confidence at time `now` (ms epoch): stored × 2^(-age/halfLife), anchored on
 *  lastAccessedAt ?? createdAt. Pure — no writes; the stored value is untouched. */
export function effectiveConfidence(entry: Entry, now: number): number {
  const stored = entry.confidence ?? 0;
  const hl = halfLifeDays(entry);
  if (!Number.isFinite(hl) || stored === 0) return stored;
  const anchorMs = Date.parse(entry.lastAccessedAt ?? entry.createdAt);
  if (Number.isNaN(anchorMs)) return stored;
  const ageDays = Math.max(0, (now - anchorMs) / MS_PER_DAY);
  return stored * Math.pow(2, -ageDays / hl);
}
