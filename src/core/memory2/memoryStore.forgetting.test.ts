import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';

const DIM = 16;
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

describe('memoryStore — forgetting (pruneEpisodes corpus bounding)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2forget-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('prunes episodes beyond the live cap, keeping the newest', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      for (let i = 0; i < 5; i++) await store.remember({ tier: 'episode', ownerId: 'o1', text: `ep${i}` });
      const n = await store.pruneEpisodes({ ownerId: 'o1', maxLive: 3, keepNewest: 1, maxAgeDays: 99999, now: NOW });
      expect(n).toBe(2); // the 2 oldest (ep0, ep1) tombstoned
      expect((await store.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['ep4', 'ep3', 'ep2']);
    } finally { await store.close(); }
  });

  it('prunes episodes older than maxAge but keeps recent ones; FACTS are never pruned', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'ancient', createdAt: '2025-01-01T00:00:00.000Z' });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'recent', createdAt: '2026-05-20T00:00:00.000Z' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' }); // a fact, must survive
      const n = await store.pruneEpisodes({ ownerId: 'o1', maxLive: 9999, maxAgeDays: 30, keepNewest: 0, now: NOW });
      expect(n).toBe(1); // only 'ancient' is past the 30-day cutoff
      expect((await store.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['recent']);
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['Neovim']); // fact untouched by episode pruning
    } finally { await store.close(); }
  });

  it('a pruned episode disappears from recall (not just recent)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'alpha apples', createdAt: '2025-01-01T00:00:00.000Z' });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'beta berries' });
      await store.pruneEpisodes({ ownerId: 'o1', maxLive: 9999, maxAgeDays: 30, keepNewest: 0, now: NOW });
      const hits = await store.recall({ query: 'alpha apples', ownerId: 'o1', k: 5 });
      expect(hits.map((h) => h.entry.text)).not.toContain('alpha apples'); // tombstoned -> excluded from search
    } finally { await store.close(); }
  });

  it('cross-launch: a pruned episode stays gone after reopen (the tombstone reconciles)', async () => {
    const s1 = await createMemoryStore({ dir, embed, dim: DIM });
    for (let i = 0; i < 4; i++) await s1.remember({ tier: 'episode', ownerId: 'o1', text: `ep${i}` });
    await s1.pruneEpisodes({ ownerId: 'o1', maxLive: 2, keepNewest: 1, maxAgeDays: 99999, now: NOW });
    await s1.close();
    const s2 = await createMemoryStore({ dir, embed, dim: DIM }); // reconcile replays put + delete ops
    try {
      expect((await s2.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['ep3', 'ep2']);
    } finally { await s2.close(); }
  });

  it('is owner-scoped — pruning one owner never touches another', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      for (let i = 0; i < 4; i++) await store.remember({ tier: 'episode', ownerId: 'o1', text: `a${i}` });
      await store.remember({ tier: 'episode', ownerId: 'o2', text: 'theirs', createdAt: '2025-01-01T00:00:00.000Z' });
      await store.pruneEpisodes({ ownerId: 'o1', maxLive: 2, keepNewest: 1, maxAgeDays: 99999, now: NOW });
      expect((await store.recent({ ownerId: 'o2', k: 10 })).map((e) => e.text)).toEqual(['theirs']); // o2 untouched
    } finally { await store.close(); }
  });
});
