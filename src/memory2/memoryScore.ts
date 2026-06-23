// src/memory2/memoryScore.ts — the hybrid recall blend (pure, testable).
//
// The recall-quality fix: pure cosine "forgets recent work because it isn't phrased like the query"
// (Generative Agents; confirmed by Roro's real-turn bug). The fix is a weighted blend of relevance
// (cosine) + recency (seq) + importance, each MIN-MAX normalized over the candidate set, deduped by id.
// Mirrors zuun's proven hybrid search + the Generative Agents formula. (Lexical/FTS via RRF is a later
// add; this lands the recency blend that directly fixes "what did we just do?".)

import type { Entry } from './types';

export interface BlendWeights {
  relevance: number;
  recency: number;
  importance: number;
}

/** Recency weighted enough to surface recent work, without drowning semantic relevance. */
export const DEFAULT_WEIGHTS: BlendWeights = { relevance: 0.5, recency: 0.4, importance: 0.1 };

export interface Candidate {
  entry: Entry;
  cosine?: number; // present for vector-channel candidates; absent (→0) for recency-only ones
}

export interface ScoredEntry {
  entry: Entry;
  score: number;
  parts: { relevance: number; recency: number; importance: number };
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

export function blendCandidates(candidates: Candidate[], weights: BlendWeights = DEFAULT_WEIGHTS): ScoredEntry[] {
  if (candidates.length === 0) return [];

  // Dedup by id, keeping the strongest cosine (a row can arrive from both the vector + recency channels).
  const byId = new Map<string, Candidate>();
  for (const c of candidates) {
    const prev = byId.get(c.entry.id);
    if (!prev || (c.cosine ?? 0) > (prev.cosine ?? 0)) byId.set(c.entry.id, c);
  }
  const rows = [...byId.values()];

  const rel = normalizeRelevance(rows.map((r) => r.cosine));
  const rec = normalize(rows.map((r) => r.entry.seq ?? 0));
  const imp = normalize(rows.map((r) => r.entry.importance ?? 0));

  return rows
    .map((r, i) => {
      const parts = { relevance: rel[i], recency: rec[i], importance: imp[i] };
      const score = weights.relevance * parts.relevance + weights.recency * parts.recency + weights.importance * parts.importance;
      return { entry: r.entry, score, parts };
    })
    .sort((a, b) => b.score - a.score);
}
