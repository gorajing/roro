// src/memory2/memoryScore.ts — the hybrid recall blend (pure, testable).
//
// The recall-quality fix: pure cosine "forgets recent work because it isn't phrased like the query"
// (Generative Agents; confirmed by Roro's real-turn bug). The fix is a weighted blend of relevance
// (cosine, min-max normalized over present cosines) + recency (ABSOLUTE time-decay over last-access age,
// NOT min-maxed — so genuinely-old episodes score low) + importance (min-max normalized), deduped by id,
// with seq as the deterministic sort tiebreak. Mirrors zuun's hybrid search + the Generative Agents
// formula. (The recall() top-2 recency guarantee — not this score — is what protects "what did we just
// do?"; lexical/FTS via RRF is a later add.)

import { effectiveRecency } from './forgetting';
import type { Entry } from './types';

export interface BlendWeights {
  relevance: number;
  recency: number;
  importance: number;
  /** ADDITIVE boost for an entry from the CURRENT repo (project-scoped recall). Optional → 0 when omitted,
   *  so a call with no currentRepoId leaves ranking byte-identical. Not part of the convex base. */
  repoMatch?: number;
}

/** Recency weighted enough to surface recent work, without drowning semantic relevance. The three base
 *  weights form a convex combination (sum 1); repoMatch (0.15) is an additive same-repo boost on top. */
export const DEFAULT_WEIGHTS: BlendWeights = { relevance: 0.5, recency: 0.4, importance: 0.1, repoMatch: 0.15 };

export interface Candidate {
  entry: Entry;
  cosine?: number; // present for vector-channel candidates; absent (→0) for recency-only ones
}

export interface ScoredEntry {
  entry: Entry;
  score: number;
  /** Raw (unnormalized) cosine from the vector channel; undefined for recency-only candidates.
   *  Carried through so callers (e.g. the old-contract adapter's MemoryMatch.similarity) can report true
   *  cosine, distinct from the blended `score`. */
  cosine?: number;
  parts: { relevance: number; recency: number; importance: number; repoMatch: number };
}

/** Min-max normalize to [0,1]; a degenerate set (all equal) maps to 1 if there's signal, else 0. */
function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => (max > 0 ? 1 : 0));
  return values.map((v) => (v - min) / (max - min));
}

/** Relevance normalized ONLY over candidates that actually have a cosine; missing-cosine -> 0 (so
 *  recency-only candidates don't distort the relevance scale). */
function normalizeRelevance(cosines: Array<number | undefined>): number[] {
  const present = cosines.filter((c): c is number => typeof c === 'number');
  if (present.length === 0) return cosines.map(() => 0);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return cosines.map((c) =>
    typeof c !== 'number' ? 0 : max === min ? (max > 0 ? 1 : 0) : (c - min) / (max - min),
  );
}

export function blendCandidates(
  candidates: Candidate[],
  weights: BlendWeights = DEFAULT_WEIGHTS,
  now: number = Date.now(),
  currentRepoId?: string,
): ScoredEntry[] {
  if (candidates.length === 0) return [];

  // Dedup by id, keeping the strongest cosine (a row can arrive from both the vector + recency channels).
  const byId = new Map<string, Candidate>();
  for (const c of candidates) {
    const prev = byId.get(c.entry.id);
    if (!prev || (c.cosine ?? 0) > (prev.cosine ?? 0)) byId.set(c.entry.id, c);
  }
  const rows = [...byId.values()];

  const rel = normalizeRelevance(rows.map((r) => r.cosine));
  // Recency is now an ABSOLUTE time-decay (exp over last-access age), NOT a min-max over seq: a genuinely
  // old episode scores low even if it's the newest in the batch (the forgetting signal). seq is the
  // deterministic tiebreak (below). Importance stays min-maxed over the candidate set.
  const rec = rows.map((r) => effectiveRecency(r.entry, now));
  const imp = normalize(rows.map((r) => r.entry.importance ?? 0));
  // repoMatch is a 0/1 flag, NOT min-max normalized: a same-repo entry is "in this project", full stop.
  // An entry with no repoId never matches (global memory isn't falsely scoped into the current repo).
  const wRepo = weights.repoMatch ?? 0;
  const repoMatch = rows.map((r) => (currentRepoId && r.entry.repoId === currentRepoId ? 1 : 0));

  return rows
    .map((r, i) => {
      const parts = { relevance: rel[i], recency: rec[i], importance: imp[i], repoMatch: repoMatch[i] };
      const score =
        weights.relevance * parts.relevance +
        weights.recency * parts.recency +
        weights.importance * parts.importance +
        wRepo * parts.repoMatch;
      return { entry: r.entry, score, cosine: r.cosine, parts };
    })
    .sort((a, b) => b.score - a.score || (b.entry.seq ?? 0) - (a.entry.seq ?? 0)); // seq breaks score ties (newer first)
}
