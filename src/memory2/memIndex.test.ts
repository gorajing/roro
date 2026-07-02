import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMemIndex } from './memIndex';
import { describeIndexStoreConformance, CONFORMANCE_DIM } from './indexStoreConformance';
import type { Entry } from './types';

// The shared IndexStore contract (the same suite the pglite engine runs — parity by test, not claim).
describeIndexStoreConformance('memIndex (in-memory)', async () => createMemIndex({ dim: CONFORMANCE_DIM }));

// ---- engine-specific guarantees (stronger than the seam requires) ----

const DIM = 8;
const unit = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
const e = (over: Partial<Entry> = {}): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't',
  createdAt: '2026-06-22T00:00:00.000Z', seq: 1, ...over,
});

describe('memIndex — engine-specific behavior', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('vectorSearch breaks cosine TIES by seq desc (deterministic ranking, newer first)', async () => {
    const ix = createMemIndex({ dim: DIM });
    await ix.upsert(e({ id: 'older', seq: 1 }), unit(0));
    await ix.upsert(e({ id: 'newer', seq: 2 }), unit(0)); // identical vector ⇒ identical similarity
    const r = await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 });
    expect(r.map((x) => x.entry.id)).toEqual(['newer', 'older']);
    await ix.close();
  });

  it('a zero-norm embedding is indexed VECTORLESS with one warning (not a NaN in the ranking)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ix = createMemIndex({ dim: DIM });
    await ix.upsert(e({ id: 'z1' }), new Array(DIM).fill(0));
    await ix.upsert(e({ id: 'z2', seq: 2 }), new Array(DIM).fill(0));
    expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 })).length).toBe(0);
    expect((await ix.recent({ ownerId: 'o1', k: 5 })).length).toBe(2); // rows still serve
    expect(warn.mock.calls.filter((args) => /zero-norm/.test(String(args[0]))).length).toBe(1); // once
    await ix.close();
  });

  it('a zero-norm QUERY returns no matches (cosine undefined) instead of throwing or NaN-ranking', async () => {
    const ix = createMemIndex({ dim: DIM });
    await ix.upsert(e({ id: 'a' }), unit(0));
    expect(await ix.vectorSearch({ ownerId: 'o1', embedding: new Array(DIM).fill(0), k: 5 })).toEqual([]);
    await ix.close();
  });

  it('vectorSearch rejects a wrong-dimension query up front', async () => {
    const ix = createMemIndex({ dim: DIM });
    await expect(ix.vectorSearch({ ownerId: 'o1', embedding: [1, 0], k: 5 })).rejects.toThrow(/dimension/i);
    await ix.close();
  });
});
