import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgliteIndex, materializeDataUrlBundlePath } from './pgliteIndex';
import { describeIndexStoreConformance, CONFORMANCE_DIM } from './indexStoreConformance';
import type { Entry } from './types';

// The shared IndexStore contract — the same suite the in-memory engine runs. Keeping this arm alive
// while both engines exist proves the swap preserves semantics (parity by test, not by claim).
describeIndexStoreConformance('pglite (PGlite + pgvector HNSW)', async () => createPgliteIndex({ dim: CONFORMANCE_DIM }));

const DIM = 8;
const unit = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
const e = (over: Partial<Entry> = {}): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 't',
  createdAt: '2026-06-22T00:00:00.000Z', seq: 1, ...over,
});

// ---- pglite-specific behavior: packaged asset materialization + PERSISTED identity guards ----
describe('pgliteIndex — engine-specific behavior', () => {
  it('materializes data-url extension bundles to file URLs for packaged Vite main builds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem2ext-'));
    try {
      const bytes = Buffer.from('vector bundle bytes');
      const url = new URL(`data:application/gzip;base64,${bytes.toString('base64')}`);
      const materialized = await materializeDataUrlBundlePath(url, dir, 'vector.tar.gz');
      expect(materialized.protocol).toBe('file:');
      expect(readFileSync(fileURLToPath(materialized))).toEqual(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
