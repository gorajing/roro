import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPgliteIndex } from './pgliteIndex';
import type { IndexStore } from './indexStore';
import type { Entry } from './types';

const DIM = 8;
const unit = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
const e = (over: Partial<Entry> = {}): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't',
  createdAt: '2026-06-22T00:00:00.000Z', seq: 1, ...over,
});

describe('pgliteIndex — derived PGlite-HNSW IndexStore', () => {
  let ix: IndexStore;
  beforeEach(async () => { ix = await createPgliteIndex({ dim: DIM }); });
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

  it('upsert by id replaces (no duplicate rows)', async () => {
    await ix.upsert(e({ id: 'a', text: 'v1' }), unit(0));
    await ix.upsert(e({ id: 'a', text: 'v2' }), unit(0));
    expect(await ix.count()).toBe(1);
    expect((await ix.recent({ ownerId: 'o1', k: 5 }))[0].text).toBe('v2');
  });

  it('recent returns newest-first by seq, owner-scoped, excludes deleted', async () => {
    await ix.upsert(e({ id: 'a', seq: 1 }));
    await ix.upsert(e({ id: 'b', seq: 2 }));
    await ix.upsert(e({ id: 'gone', seq: 3, deletedAt: '2026-06-22T01:00:00.000Z' }));
    await ix.upsert(e({ id: 'other', seq: 4, ownerId: 'o2' }));
    expect((await ix.recent({ ownerId: 'o1', k: 5 })).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('facts returns active facts only (newest first) and enforces one active fact per (owner, key)', async () => {
    await ix.upsert(e({ id: 'f1', tier: 'fact', factKey: 'pkg', text: 'npm', seq: 1 }), unit(0));
    // a SECOND active fact for the same (owner, factKey) must violate the structural unique index
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

  it('reindexFrom rebuilds the index from entries (the rebuildable-cache property)', async () => {
    const entries = [e({ id: 'a', text: 'apple', seq: 1 }), e({ id: 'b', text: 'banana', seq: 2 })];
    await ix.reindexFrom(entries, async (t) => (t === 'apple' ? unit(0) : unit(1)));
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

  it('fails loud when reopening a persisted index with a different embedding dimension', async () => {
    const persistDir = mkdtempSync(join(tmpdir(), 'mem2dim-'));
    try {
      const a = await createPgliteIndex({ dataDir: persistDir, dim: 8 });
      await a.upsert(e({ id: 'a' }), unit(0));
      await a.close();
      await expect(createPgliteIndex({ dataDir: persistDir, dim: 16 })).rejects.toThrow(/dimension/i);
      const b = await createPgliteIndex({ dataDir: persistDir, dim: 8 }); // same dim reopens fine
      expect(await b.count()).toBe(1);
      await b.close();
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
    }
  });

  it('fails loud when reopening a persisted index built with a DIFFERENT embed model (same dim)', async () => {
    // The dim guard catches 768->1536, but two different 768-dim models produce incompatible vector
    // spaces with the same column type — silent recall corruption. Guard on model identity too.
    const persistDir = mkdtempSync(join(tmpdir(), 'mem2model-'));
    try {
      const a = await createPgliteIndex({ dataDir: persistDir, dim: 8, embedModel: 'nomic-embed-text' });
      await a.upsert(e({ id: 'a' }), unit(0));
      await a.close();
      await expect(createPgliteIndex({ dataDir: persistDir, dim: 8, embedModel: 'mxbai-embed-large' })).rejects.toThrow(/model/i);
      const b = await createPgliteIndex({ dataDir: persistDir, dim: 8, embedModel: 'nomic-embed-text' }); // same model reopens fine
      expect(await b.count()).toBe(1);
      await b.close();
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
    }
  });
});
