import { describe, it, expect } from 'vitest';
import { importanceFor } from './importance';
import type { EpisodeKind } from '../../shared/memory';

// importance (1-10) is stamped deterministically by EPISODE KIND — NOT rated by the 3B model (the M2.5
// lesson: deterministic discipline beats trusting a noisy model with memory quality). It nudges episode
// recall so the user's OWN words rank above the cat's paraphrase. Facts are a TIER, not a kind — recall
// excludes them and getProfile surfaces them separately, so they have no importance row (the old fact:8
// row was dead code: replaceFact never stamped importance).

describe('importanceFor', () => {
  it('ranks: observation (user said) > action > narration (cat paraphrase)', () => {
    expect(importanceFor('observation')).toBeGreaterThan(importanceFor('action'));
    expect(importanceFor('action')).toBeGreaterThan(importanceFor('narration'));
  });

  it('the user\'s own words outrank the cat\'s paraphrase (the recall-quality point)', () => {
    expect(importanceFor('observation')).toBeGreaterThan(importanceFor('narration'));
  });

  it('every episode kind maps into the documented 1-10 range', () => {
    for (const k of ['observation', 'action', 'narration'] as EpisodeKind[]) {
      const v = importanceFor(k);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('is deterministic (pure map, no model call, no randomness)', () => {
    expect(importanceFor('observation')).toBe(importanceFor('observation'));
  });
});
