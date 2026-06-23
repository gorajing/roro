import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryWriter } from './store';
import { readManifest } from './manifest';
import { readEntryFile, entryPath } from './entryFile';
import { recentEpisodes } from './episodeLog';
import type { Entry } from './types';

type NewEntry = Omit<Entry, 'seq' | 'contentHash'>;
const fact = (over: Partial<NewEntry> = {}): NewEntry => ({
  id: over.id ?? 'f1', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'pkg',
  text: 'uses pnpm', payload: { key: 'pkg', value: 'pnpm' }, createdAt: '2026-06-22T00:00:00.000Z', ...over,
});
const episode = (over: Partial<NewEntry> = {}): NewEntry => ({
  id: over.id ?? 'e1', schemaVersion: 1, tier: 'episode', ownerId: 'o1',
  text: 'did a thing', createdAt: '2026-06-22T00:00:00.000Z', ...over,
});

describe('store — serialized, ordered, durable writer (the files-as-truth contract)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2store-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('putEntry commits the content file AND a matching manifest op (ordered commit), stamping seq + contentHash', async () => {
    const w = createMemoryWriter({ dir });
    const e = await w.putEntry(fact());
    expect(e.seq).toBe(1);
    expect(e.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // content file exists and round-trips
    expect(existsSync(entryPath(dir, e as Entry))).toBe(true);
    expect((await readEntryFile(entryPath(dir, e as Entry))).text).toBe('uses pnpm');
    // manifest has exactly one op, referencing the same id/seq/hash
    const ops = await readManifest(dir);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ seq: 1, op: 'put', id: 'f1', tier: 'fact', ownerId: 'o1', contentHash: e.contentHash });
  });

  it('routes episodes to the JSONL log (not a per-file entry) and records a manifest op', async () => {
    const w = createMemoryWriter({ dir });
    const e = await w.putEntry(episode());
    expect(existsSync(entryPath(dir, e as Entry))).toBe(false); // NOT a per-file durable entry
    expect((await recentEpisodes(dir, 'o1', 5)).map((x) => x.id)).toEqual(['e1']);
    expect((await readManifest(dir))).toHaveLength(1);
  });

  it('serializes concurrent writes — distinct, monotonic seqs (no nextSeq race)', async () => {
    const w = createMemoryWriter({ dir });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => w.putEntry(episode({ id: `e${i}` }))),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => (a! - b!));
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)); // 1..20, no dupes/gaps
  });

  it('seq continues monotonically across a reopen (new writer reads the manifest)', async () => {
    await createMemoryWriter({ dir }).putEntry(fact({ id: 'f1', factKey: 'a' }));
    const e2 = await createMemoryWriter({ dir }).putEntry(fact({ id: 'f2', factKey: 'b' }));
    expect(e2.seq).toBe(2);
  });

  it('deleteEntry records a tombstone op and removes a durable entry file', async () => {
    const w = createMemoryWriter({ dir });
    const e = await w.putEntry(fact());
    await w.deleteEntry({ tier: 'fact', id: 'f1', ownerId: 'o1' });
    expect(existsSync(entryPath(dir, e as Entry))).toBe(false);
    const ops = await readManifest(dir);
    expect(ops.map((o) => o.op)).toEqual(['put', 'delete']);
  });
});
