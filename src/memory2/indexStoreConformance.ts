// src/memory2/indexStoreConformance.ts — the IndexStore behavioral contract as a runnable suite.
//
// Generalized from pgliteIndex.test.ts so EVERY engine behind the IndexStore seam proves the same
// semantics: while both engines exist, the pglite arm proves the in-memory engine is a faithful swap
// (parity by shared test, not by claim); after the cutover the suite keeps the seam honest for any
// future engine. Engine-SPECIFIC behavior (pglite asset materialization / persisted-identity guards;
// memIndex deterministic tiebreaks) stays in each engine's own test file.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IndexStore } from './indexStore';
import type { Entry } from './types';

export const CONFORMANCE_DIM = 8;

const DIM = CONFORMANCE_DIM;
const unit = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
const e = (over: Partial<Entry> = {}): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't',
  createdAt: '2026-06-22T00:00:00.000Z', seq: 1, ...over,
});

export function describeIndexStoreConformance(engine: string, makeIndex: () => Promise<IndexStore>): void {
  describe(`IndexStore conformance — ${engine}`, () => {
    let ix: IndexStore;
    beforeEach(async () => { ix = await makeIndex(); });
    afterEach(async () => { await ix.close(); });

    it('upsert + vectorSearch returns owner-scoped matches ranked by cosine', async () => {
      await ix.upsert(e({ id: 'a', ownerId: 'o1' }), unit(0));
      await ix.upsert(e({ id: 'b', ownerId: 'o1' }), unit(1));
      await ix.upsert(e({ id: 'c', ownerId: 'o2' }), unit(0)); // other owner — must not leak
      const r = await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 });
      expect(r.map((x) => x.entry.id)).toEqual(['a', 'b']); // o1 only, a closest
      expect(r[0].similarity).toBeGreaterThan(r[1].similarity);
      expect(r[0].similarity).toBeCloseTo(1, 5);
    });

    it('vectorSearch cosine matches the analytic value for non-unit vectors', async () => {
      // [3,4,0,...] vs [4,3,0,...]: cos = (12+12)/(5·5) = 0.96 — pins normalization/accumulator parity.
      const a = [3, 4, 0, 0, 0, 0, 0, 0];
      const q = [4, 3, 0, 0, 0, 0, 0, 0];
      await ix.upsert(e({ id: 'a' }), a);
      const r = await ix.vectorSearch({ ownerId: 'o1', embedding: q, k: 1 });
      expect(r[0].similarity).toBeCloseTo(0.96, 5);
    });

    it('upsert by id replaces (no duplicate rows)', async () => {
      await ix.upsert(e({ id: 'a', text: 'v1' }), unit(0));
      await ix.upsert(e({ id: 'a', text: 'v2' }), unit(0));
      expect(await ix.count()).toBe(1);
      expect((await ix.recent({ ownerId: 'o1', k: 5 }))[0].text).toBe('v2');
    });

    it('upsert with an OMITTED embedding clears a previously-stored vector (vector tracks the latest doc)', async () => {
      await ix.upsert(e({ id: 'a', text: 'v1' }), unit(0));
      await ix.upsert(e({ id: 'a', text: 'v2 (embed failed)' })); // no vector this time
      expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 })).length).toBe(0);
      expect((await ix.recent({ ownerId: 'o1', k: 5 }))[0].text).toBe('v2 (embed failed)'); // row still serves
    });

    it('upsert rejects an embedding whose dimension does not match the index', async () => {
      await expect(ix.upsert(e({ id: 'a' }), [1, 0])).rejects.toThrow();
    });

    it('recent returns newest-first by seq, owner-scoped, excludes deleted', async () => {
      await ix.upsert(e({ id: 'a', seq: 1 }));
      await ix.upsert(e({ id: 'b', seq: 2 }));
      await ix.upsert(e({ id: 'gone', seq: 3, deletedAt: '2026-06-22T01:00:00.000Z' }));
      await ix.upsert(e({ id: 'other', seq: 4, ownerId: 'o2' }));
      expect((await ix.recent({ ownerId: 'o1', k: 5 })).map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('recent + vectorSearch honor the tier filter (the recall path is episodes-only)', async () => {
      await ix.upsert(e({ id: 'ep', tier: 'episode', seq: 1 }), unit(0));
      await ix.upsert(e({ id: 'tr', tier: 'trace', seq: 2 }), unit(0));
      expect((await ix.recent({ ownerId: 'o1', k: 5, tier: 'episode' })).map((x) => x.id)).toEqual(['ep']);
      expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5, tier: 'episode' })).map((x) => x.entry.id)).toEqual(['ep']);
    });

    it('facts returns active facts only (newest first) and enforces one active fact per (owner, key)', async () => {
      await ix.upsert(e({ id: 'f1', tier: 'fact', factKey: 'pkg', text: 'npm', seq: 1 }), unit(0));
      // a SECOND active fact for the same (owner, factKey) must violate the structural invariant
      await expect(
        ix.upsert(e({ id: 'f2', tier: 'fact', factKey: 'pkg', text: 'pnpm', seq: 2 }), unit(0)),
      ).rejects.toThrow();
      // a superseded prior fact does not block + does not surface
      await ix.upsert(e({ id: 'f0', tier: 'fact', factKey: 'lang', text: 'js', seq: 3, superseded: true }), unit(1));
      expect((await ix.facts('o1')).map((x) => x.text)).toEqual(['npm']);
    });

    it('vectorSearch excludes superseded + deleted rows', async () => {
      await ix.upsert(e({ id: 'live', seq: 1 }), unit(0));
      await ix.upsert(e({ id: 'sup', seq: 2, superseded: true }), unit(0));
      await ix.upsert(e({ id: 'del', seq: 3, deletedAt: '2026-06-22T01:00:00.000Z' }), unit(0));
      expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 })).map((x) => x.entry.id)).toEqual(['live']);
    });

    it('get / remove round-trip a row by id', async () => {
      await ix.upsert(e({ id: 'a', text: 'kept' }), unit(0));
      expect((await ix.get('a'))?.text).toBe('kept');
      await ix.remove('a');
      expect(await ix.get('a')).toBeUndefined();
      expect(await ix.count()).toBe(0);
    });

    it('count + maxSeq reflect the rows; maxSeq is 0 when empty', async () => {
      expect(await ix.maxSeq()).toBe(0);
      await ix.upsert(e({ id: 'a', seq: 3 }));
      await ix.upsert(e({ id: 'b', seq: 7 }));
      expect(await ix.count()).toBe(2);
      expect(await ix.maxSeq()).toBe(7);
    });

    it('applied-seq cursor: starts at 0, set/get round-trips within a session', async () => {
      expect(await ix.getAppliedSeq()).toBe(0);
      await ix.setAppliedSeq(41);
      expect(await ix.getAppliedSeq()).toBe(41);
    });

    it('episodesToPrune: per-owner keepNewest + live-cap window, oldest first, capped at batchSize', async () => {
      for (let i = 1; i <= 5; i++) {
        await ix.upsert(e({ id: `ep${i}`, seq: i, createdAt: `2026-06-0${i}T00:00:00.000Z` }));
      }
      // keepNewest=1, maxLive=3 → rows ranked 4..5 newest-first (ep2, ep1) are victims, OLDEST first.
      const victims = await ix.episodesToPrune({ ownerId: 'o1', maxLive: 3, maxAgeCutoff: '2020-01-01T00:00:00.000Z', keepNewest: 1, batchSize: 10 });
      expect(victims).toEqual([{ id: 'ep1', ownerId: 'o1' }, { id: 'ep2', ownerId: 'o1' }]);
      // batchSize caps the sweep
      const capped = await ix.episodesToPrune({ ownerId: 'o1', maxLive: 3, maxAgeCutoff: '2020-01-01T00:00:00.000Z', keepNewest: 1, batchSize: 1 });
      expect(capped).toEqual([{ id: 'ep1', ownerId: 'o1' }]);
    });

    it('episodesToPrune: age cutoff prunes old episodes; facts/traces/deleted/other owners are never victims', async () => {
      await ix.upsert(e({ id: 'ancient', seq: 1, createdAt: '2025-01-01T00:00:00.000Z' }));
      await ix.upsert(e({ id: 'fresh', seq: 2, createdAt: '2026-06-20T00:00:00.000Z' }));
      await ix.upsert(e({ id: 'f1', tier: 'fact', factKey: 'k', seq: 3, createdAt: '2025-01-01T00:00:00.000Z' }));
      await ix.upsert(e({ id: 'tr', tier: 'trace', seq: 4, createdAt: '2025-01-01T00:00:00.000Z' }));
      await ix.upsert(e({ id: 'dead', seq: 5, createdAt: '2025-01-01T00:00:00.000Z', deletedAt: '2026-01-01T00:00:00.000Z' }));
      await ix.upsert(e({ id: 'theirs', ownerId: 'o2', seq: 6, createdAt: '2025-01-01T00:00:00.000Z' }));
      const victims = await ix.episodesToPrune({ ownerId: 'o1', maxLive: 9999, maxAgeCutoff: '2026-01-01T00:00:00.000Z', keepNewest: 0, batchSize: 10 });
      expect(victims).toEqual([{ id: 'ancient', ownerId: 'o1' }]);
    });

    it('episodesToPrune without ownerId partitions per owner (caps apply within each owner)', async () => {
      for (let i = 1; i <= 3; i++) await ix.upsert(e({ id: `a${i}`, ownerId: 'o1', seq: i }));
      for (let i = 1; i <= 3; i++) await ix.upsert(e({ id: `b${i}`, ownerId: 'o2', seq: 10 + i }));
      const victims = await ix.episodesToPrune({ maxLive: 2, maxAgeCutoff: '2020-01-01T00:00:00.000Z', keepNewest: 2, batchSize: 10 });
      expect(victims.map((v) => v.id).sort()).toEqual(['a1', 'b1']); // the oldest of EACH owner
    });

    it('reindexFrom rebuilds the index from entries (the rebuildable-cache property)', async () => {
      const entries = [e({ id: 'a', text: 'apple', seq: 1 }), e({ id: 'b', text: 'banana', seq: 2 })];
      await ix.reindexFrom(entries, async (entry) => ({ embedding: entry.text === 'apple' ? unit(0) : unit(1) }));
      expect(await ix.count()).toBe(2);
      expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 }))[0].entry.id).toBe('a');
    });

    it('reindexFrom failure preserves the existing index (embed-all-first, then swap)', async () => {
      await ix.upsert(e({ id: 'keep', seq: 1 }), unit(0));
      await expect(
        ix.reindexFrom([e({ id: 'new', text: 'boom', seq: 2 })], async () => { throw new Error('embed down'); }),
      ).rejects.toThrow('embed down');
      expect(await ix.count()).toBe(1); // old index untouched
      expect((await ix.recent({ ownerId: 'o1', k: 5 }))[0].id).toBe('keep');
    });

    it('reindexFrom stamps embeddingStatus=failed on {failed:true} rows and indexes them vectorless', async () => {
      await ix.reindexFrom([e({ id: 'a', seq: 1 })], async () => ({ failed: true }));
      expect((await ix.get('a'))?.embeddingStatus).toBe('failed');
      expect((await ix.vectorSearch({ ownerId: 'o1', embedding: unit(0), k: 5 })).length).toBe(0);
      expect((await ix.recent({ ownerId: 'o1', k: 5 })).map((x) => x.id)).toEqual(['a']); // still serves reads
    });
  });
}
