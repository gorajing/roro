import { describe, it, expect } from 'vitest';
import { effectiveConfidence, effectiveRecency, halfLifeDays } from './forgetting';
import type { Entry } from './types';

const MS_PER_DAY = 86_400_000;
const fact = (over: Partial<Entry> = {}): Entry => ({
  id: 'f', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'k', text: 'v',
  createdAt: '2026-01-01T00:00:00.000Z', confidence: 0.8, ...over,
});
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('forgetting — lazy effective-confidence decay (stored evidence vs retrieval strength)', () => {
  it('does not decay at age 0 (effective == stored)', () => {
    expect(effectiveConfidence(fact(), NOW)).toBeCloseTo(0.8, 6);
  });

  it('halves confidence after one half-life (default fact = 180 days)', () => {
    const e = fact();
    expect(effectiveConfidence(e, NOW + 180 * MS_PER_DAY)).toBeCloseTo(0.4, 5);
    expect(effectiveConfidence(e, NOW + 360 * MS_PER_DAY)).toBeCloseTo(0.2, 5);
  });

  it('decays from lastAccessedAt when present (reinforcement keeps a fact hot)', () => {
    const stale = fact({ createdAt: '2025-01-01T00:00:00.000Z' }); // ~1yr old by createdAt
    const refreshed = fact({ createdAt: '2025-01-01T00:00:00.000Z', lastAccessedAt: '2026-01-01T00:00:00.000Z' });
    expect(effectiveConfidence(stale, NOW)).toBeLessThan(effectiveConfidence(refreshed, NOW));
    expect(effectiveConfidence(refreshed, NOW)).toBeCloseTo(0.8, 6); // refreshed today -> no decay
  });

  it('ttlPolicy tunes the half-life: transient decays faster, stable never decays', () => {
    const t = NOW + 60 * MS_PER_DAY;
    expect(effectiveConfidence(fact({ ttlPolicy: 'transient' }), t)).toBeLessThan(effectiveConfidence(fact({ ttlPolicy: 'project' }), t));
    expect(effectiveConfidence(fact({ ttlPolicy: 'stable' }), t)).toBeCloseTo(0.8, 6); // no decay
    expect(halfLifeDays(fact({ ttlPolicy: 'stable' }))).toBe(Infinity);
  });

  it('core never decays; only facts decay (episodes are bounded by pruning, not confidence)', () => {
    const t = NOW + 1000 * MS_PER_DAY;
    expect(effectiveConfidence(fact({ tier: 'core', confidence: 0.8 }), t)).toBeCloseTo(0.8, 6);
    expect(halfLifeDays({ ...fact(), tier: 'episode' })).toBe(Infinity);
  });

  it('treats a missing confidence as 0', () => {
    expect(effectiveConfidence(fact({ confidence: undefined }), NOW)).toBe(0);
  });

  it('effectiveRecency time-decays from last-access (30-day half-life), 1 at age 0', () => {
    const ep = (over: Partial<Entry> = {}): Entry => ({ ...fact(), tier: 'episode', factKey: undefined, ...over });
    expect(effectiveRecency(ep({ createdAt: '2026-01-01T00:00:00.000Z' }), NOW)).toBeCloseTo(1, 6); // age 0
    expect(effectiveRecency(ep({ createdAt: '2026-01-01T00:00:00.000Z' }), NOW + 30 * MS_PER_DAY)).toBeCloseTo(0.5, 5); // one half-life
    // last-access refreshes recency: a re-surfaced old episode scores higher than an untouched one
    const stale = ep({ createdAt: '2025-01-01T00:00:00.000Z' });
    const refreshed = ep({ createdAt: '2025-01-01T00:00:00.000Z', lastAccessedAt: '2026-01-01T00:00:00.000Z' });
    expect(effectiveRecency(refreshed, NOW)).toBeGreaterThan(effectiveRecency(stale, NOW));
  });
});
