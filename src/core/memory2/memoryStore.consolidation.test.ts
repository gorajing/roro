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

describe('memoryStore — consolidation (confidence accrual via corroboration)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2consol-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('replaceFact stamps a base confidence on a new fact', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
      const [f] = await store.getProfile('o1');
      expect(f.confidence).toBeGreaterThan(0); // a single observation carries a base confidence
      expect(f.confidence).toBeLessThan(1);
    } finally { await store.close(); }
  });

  it('reinforceFact strengthens an active fact IN PLACE (same row, same value, no churn)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      const fresh = await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
      const base = fresh.confidence ?? 0;
      const r = await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' });
      expect(r?.confidence).toBeGreaterThan(base); // corroboration raises confidence
      expect(r?.accessCount).toBe(1);
      const profile = await store.getProfile('o1');
      expect(profile.length).toBe(1); // still exactly one active fact (no duplicate, no churn)
      expect(profile[0].id).toBe(fresh.id); // the SAME row, updated in place
      expect(profile[0].text).toBe('Neovim');
      expect(profile[0].confidence).toBeGreaterThan(base);
    } finally { await store.close(); }
  });

  it('reinforceFact caps confidence at 1 and never exceeds it', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
      for (let i = 0; i < 20; i++) await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' });
      const [f] = await store.getProfile('o1');
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.confidence).toBeGreaterThan(0.9); // many corroborations -> near-certain
    } finally { await store.close(); }
  });

  it('reinforceFact is a no-op (returns null) when no active fact exists for the key', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect(await store.reinforceFact({ ownerId: 'o1', factKey: 'missing' })).toBeNull();
    } finally { await store.close(); }
  });

  it('getProfile surfaces higher-confidence facts first', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'a', text: 'A' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'b', text: 'B' }); // newer, but never corroborated
      await store.reinforceFact({ ownerId: 'o1', factKey: 'a' }); // a is now more confident
      expect((await store.getProfile('o1')).map((f) => f.factKey)).toEqual(['a', 'b']);
    } finally { await store.close(); }
  });

  it('survives a cross-launch: reinforced confidence persists', async () => {
    const s1 = await createMemoryStore({ dir, embed, dim: DIM });
    await s1.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
    await s1.reinforceFact({ ownerId: 'o1', factKey: 'editor' });
    const reinforced = (await s1.getProfile('o1'))[0].confidence ?? 0;
    await s1.close();
    const s2 = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await s2.getProfile('o1'))[0].confidence).toBeCloseTo(reinforced, 5);
    } finally { await s2.close(); }
  });
});
