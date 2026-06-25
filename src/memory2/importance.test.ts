import { describe, it, expect } from 'vitest';
import { importanceFor } from './importance';
import type { MemoryKind } from '../shared/memory';

// importance (1-10) is stamped deterministically by memory KIND — NOT rated by the 3B model (the M2.5 lesson:
// deterministic discipline beats trusting a noisy model with memory quality). It nudges episode recall so the
// user's OWN words rank above the cat's paraphrase, and durable facts rank highest.

describe('importanceFor', () => {
  it('ranks: fact > observation (user said) > action > narration (cat paraphrase)', () => {
    expect(importanceFor('fact')).toBeGreaterThan(importanceFor('observation'));
    expect(importanceFor('observation')).toBeGreaterThan(importanceFor('action'));
    expect(importanceFor('action')).toBeGreaterThan(importanceFor('narration'));
  });

  it('the user\'s own words outrank the cat\'s paraphrase (the recall-quality point)', () => {
    expect(importanceFor('observation')).toBeGreaterThan(importanceFor('narration'));
  });

  it('every kind maps into the documented 1-10 range', () => {
    for (const k of ['fact', 'observation', 'action', 'narration'] as MemoryKind[]) {
      const v = importanceFor(k);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('is deterministic (pure map, no model call, no randomness)', () => {
    expect(importanceFor('fact')).toBe(importanceFor('fact'));
  });
});
