import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';
import { createMemoryWriter } from './store';

const DIM = 16;
// Deterministic fake embedder: first char -> a unit dimension, so identical text recalls itself.
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};

describe('memoryStore — unified API + cursor-based reconciliation', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2store-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('remember (episodes) -> recall (episodic) + recent', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'added a logout route' });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'ran the tests' });
      const hits = await store.recall({ query: 'added a logout route', ownerId: 'o1', k: 5 });
      expect(hits.map((h) => h.entry.text)).toContain('added a logout route');
      expect(hits.every((h) => h.entry.tier === 'episode')).toBe(true);
      expect((await store.recent({ ownerId: 'o1', k: 5 }))[0].text).toBe('ran the tests'); // newest first
    } finally { await store.close(); }
  });

  it('is owner-scoped — no cross-owner leakage', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'mine' });
      await store.remember({ tier: 'episode', ownerId: 'o2', text: 'theirs' });
      expect((await store.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toEqual(['mine']);
    } finally { await store.close(); }
  });

  it('remember() rejects facts (they need the atomic replaceFact)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await expect(store.remember({ tier: 'fact', ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm' })).rejects.toThrow(/replaceFact/);
    } finally { await store.close(); }
  });

  it('reconciles on open — rebuilds the index from files+manifest when the index is behind (crash recovery)', async () => {
    const writer = createMemoryWriter({ dir });
    await writer.putEntry({ id: 'e1', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 'recovered episode', createdAt: '2026-06-22T00:00:00.000Z' });
    await writer.putEntry({ id: 'f1', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm', payload: { key: 'pkg', value: 'pnpm' }, createdAt: '2026-06-22T00:00:00.000Z' });
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await store.recent({ ownerId: 'o1', k: 5 })).map((e) => e.id)).toEqual(['e1']);
      expect((await store.getProfile('o1')).map((f) => f.id)).toEqual(['f1']);
      expect((await store.recall({ query: 'recovered episode', ownerId: 'o1', k: 5 })).map((h) => h.entry.id)).toContain('e1');
    } finally { await store.close(); }
  });

  it('persists across reopen and reconcile is a no-op (cursor up to date)', async () => {
    const a = await createMemoryStore({ dir, embed, dim: DIM });
    await a.remember({ tier: 'episode', ownerId: 'o1', text: 'persist me' });
    await a.close();
    const b = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await b.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toEqual(['persist me']);
    } finally { await b.close(); }
  });

  it('delete cursor survives a tombstone (put+delete -> empty, and stays empty on reopen, no replay)', async () => {
    const writer = createMemoryWriter({ dir });
    await writer.putEntry({ id: 'e1', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 'gone', createdAt: '2026-06-22T00:00:00.000Z' });
    await writer.deleteEntry({ tier: 'episode', id: 'e1', ownerId: 'o1' });
    const a = await createMemoryStore({ dir, embed, dim: DIM });
    expect(await a.recent({ ownerId: 'o1', k: 5 })).toEqual([]);
    await a.close();
    const b = await createMemoryStore({ dir, embed, dim: DIM }); // cursor advanced past the delete — no error/replay
    try { expect(await b.recent({ ownerId: 'o1', k: 5 })).toEqual([]); } finally { await b.close(); }
  });

  it('degrades gracefully when the embedder fails — the row is indexed (recent) but un-recallable (no vector)', async () => {
    const writer = createMemoryWriter({ dir });
    await writer.putEntry({ id: 'e1', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 'boom', createdAt: '2026-06-22T00:00:00.000Z' });
    const flaky = async (t: string): Promise<number[]> => { if (t === 'boom') throw new Error('embed down'); return embed(t); };
    const store = await createMemoryStore({ dir, embed: flaky, dim: DIM });
    try {
      expect((await store.recent({ ownerId: 'o1', k: 5 })).map((e) => e.id)).toEqual(['e1']); // indexed without vector
      expect(await store.recall({ query: 'anything else', ownerId: 'o1', k: 5 })).toEqual([]); // no vector to match
    } finally { await store.close(); }
  });
});
