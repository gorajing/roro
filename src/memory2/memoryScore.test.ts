import { describe, it, expect } from 'vitest';
import { blendCandidates, DEFAULT_WEIGHTS } from './memoryScore';
import type { Entry } from './types';

const e = (over: Partial<Entry>): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't', createdAt: '2026-06-22T00:00:00.000Z', ...over,
});

describe('blendCandidates — recency + cosine + importance blend (the recall-quality fix)', () => {
  it('preserves the RAW cosine on each scored entry (undefined for recency-only)', () => {
    // The adapter projects this raw cosine back to the old MemoryMatch.similarity contract — so it must
    // be the unnormalized index cosine, NOT the blended rank or the min-max relevance part.
    const ranked = blendCandidates([
      { entry: e({ id: 'hit', seq: 2 }), cosine: 0.42 },
      { entry: e({ id: 'recent-only', seq: 1 }) },
    ]);
    const byId = new Map(ranked.map((r) => [r.entry.id, r]));
    expect(byId.get('hit')?.cosine).toBe(0.42); // raw, not normalized to 1
    expect(byId.get('recent-only')?.cosine).toBeUndefined(); // no vector channel -> no cosine
  });

  it('a RECENT low-cosine item still surfaces (the temporal-recall fix; recency = time-decay)', () => {
    // "old" is a perfect cosine match but ANCIENT (months old); "fresh" barely matches but is from today.
    const now = Date.parse('2026-06-23T00:00:00.000Z');
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'old', seq: 1, createdAt: '2026-01-01T00:00:00.000Z' }), cosine: 0.9 },
        { entry: e({ id: 'fresh', seq: 100, createdAt: '2026-06-23T00:00:00.000Z' }), cosine: 0.1 },
      ],
      { relevance: 0.3, recency: 0.7, importance: 0 },
      now,
    );
    expect(ranked.map((r) => r.entry.id)).toEqual(['fresh', 'old']); // time-decay recency lifts the fresh item
  });

  it('pure cosine weighting ranks by relevance', () => {
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'a', seq: 1 }), cosine: 0.2 },
        { entry: e({ id: 'b', seq: 2 }), cosine: 0.9 },
      ],
      { relevance: 1, recency: 0, importance: 0 },
    );
    expect(ranked.map((r) => r.entry.id)).toEqual(['b', 'a']);
  });

  it('dedups by id, keeping the higher cosine (a row matched by both channels appears once)', () => {
    const ranked = blendCandidates([
      { entry: e({ id: 'dup', seq: 5 }), cosine: 0.2 },
      { entry: e({ id: 'dup', seq: 5 }), cosine: 0.8 }, // same row, from the recency channel
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].parts.relevance).toBeGreaterThan(0); // used the 0.8 cosine
  });

  it('importance can lift an item; parts are explainable', () => {
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'plain', seq: 2, importance: 1 }), cosine: 0.5 },
        { entry: e({ id: 'key', seq: 1, importance: 10 }), cosine: 0.5 },
      ],
      { relevance: 0, recency: 0, importance: 1 },
    );
    expect(ranked[0].entry.id).toBe('key');
    expect(ranked[0].parts).toHaveProperty('importance');
    expect(ranked[0].parts).toHaveProperty('recency');
    expect(ranked[0].parts).toHaveProperty('relevance');
  });

  it('handles a single candidate and an empty set', () => {
    expect(blendCandidates([])).toEqual([]);
    const one = blendCandidates([{ entry: e({ id: 'solo', seq: 1 }), cosine: 0.5 }]);
    expect(one).toHaveLength(1);
    expect(one[0].score).toBeGreaterThan(0);
  });

  it('normalizes relevance only over candidates that have a cosine (recency-only rows do not distort it)', () => {
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'a', seq: 1 }), cosine: 0.4 },
        { entry: e({ id: 'b', seq: 2 }), cosine: 0.8 },
        { entry: e({ id: 'c', seq: 3 }) }, // recency-only — no cosine
      ],
      { relevance: 1, recency: 0, importance: 0 },
    );
    const rel = Object.fromEntries(ranked.map((r) => [r.entry.id, r.parts.relevance]));
    expect(rel.a).toBeCloseTo(0, 5); // min of the two present cosines
    expect(rel.b).toBeCloseTo(1, 5); // max of the two present cosines
    expect(rel.c).toBe(0); // no cosine -> 0, outside the relevance scale
  });

  it('the three BASE weights (relevance + recency + importance) sum to 1', () => {
    const sum = DEFAULT_WEIGHTS.relevance + DEFAULT_WEIGHTS.recency + DEFAULT_WEIGHTS.importance;
    expect(sum).toBeCloseTo(1, 5); // repoMatch is an ADDITIVE project-scope boost on top, not part of this convex base
  });
});

describe('blendCandidates — repo-scoped recall (M5b: "remembers you HERE")', () => {
  it('boosts a same-repo entry over an otherwise-equal cross-repo entry', () => {
    // Equal cosine + equal recency + equal importance → repoMatch is the ONLY differentiator.
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'here', seq: 1, repoId: 'repoA' }), cosine: 0.5 },
        { entry: e({ id: 'elsewhere', seq: 1, repoId: 'repoB' }), cosine: 0.5 },
      ],
      DEFAULT_WEIGHTS,
      Date.parse('2026-06-22T00:00:00.000Z'),
      'repoA',
    );
    expect(ranked[0].entry.id).toBe('here');
    expect(ranked[0].parts.repoMatch).toBe(1);
    expect(ranked.find((r) => r.entry.id === 'elsewhere')?.parts.repoMatch).toBe(0);
  });

  it('is BACKWARD-COMPATIBLE: with no current repo, repoMatch is 0 for all and ranking is unchanged', () => {
    const base = [
      { entry: e({ id: 'a', seq: 2, repoId: 'repoA' }), cosine: 0.9 },
      { entry: e({ id: 'b', seq: 1, repoId: 'repoB' }), cosine: 0.1 },
    ];
    const ranked = blendCandidates(base, { relevance: 1, recency: 0, importance: 0 }); // no currentRepoId arg
    expect(ranked.map((r) => r.entry.id)).toEqual(['a', 'b']);
    expect(ranked.every((r) => r.parts.repoMatch === 0)).toBe(true);
  });

  it('an entry with NO repoId never matches (global memory is not falsely boosted into a repo)', () => {
    const ranked = blendCandidates(
      [{ entry: e({ id: 'global', seq: 1 }) }],
      DEFAULT_WEIGHTS,
      Date.parse('2026-06-22T00:00:00.000Z'),
      'repoA',
    );
    expect(ranked[0].parts.repoMatch).toBe(0);
  });
});
