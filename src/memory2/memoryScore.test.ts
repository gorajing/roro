import { describe, it, expect } from 'vitest';
import { blendCandidates, DEFAULT_WEIGHTS } from './memoryScore';
import type { Entry } from './types';

const e = (over: Partial<Entry>): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't', createdAt: '2026-06-22T00:00:00.000Z', ...over,
});

describe('blendCandidates — recency + cosine + importance blend (the recall-quality fix)', () => {
  it('a RECENT low-cosine item still surfaces (the temporal-recall fix)', () => {
    // "old" is a perfect cosine match but ancient; "fresh" barely matches but is the newest.
    const ranked = blendCandidates(
      [
        { entry: e({ id: 'old', seq: 1 }), cosine: 0.9 },
        { entry: e({ id: 'fresh', seq: 100 }), cosine: 0.1 },
      ],
      { relevance: 0.3, recency: 0.7, importance: 0 },
    );
    expect(ranked.map((r) => r.entry.id)).toEqual(['fresh', 'old']); // recency lifts the fresh item to the top
    expect(ranked.map((r) => r.entry.id)).toContain('fresh'); // and a recent item is never dropped (no floor)
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

  it('exposes DEFAULT_WEIGHTS summing to 1', () => {
    const sum = DEFAULT_WEIGHTS.relevance + DEFAULT_WEIGHTS.recency + DEFAULT_WEIGHTS.importance;
    expect(sum).toBeCloseTo(1, 5);
  });
});
