import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory2Adapter, type Memory2Adapter } from './adapter';
import type { RememberInput, ReplaceFactInput } from '../shared/memory';

const DIM = 16;
// Deterministic fake embedder: first char -> a unit dimension, so identical text recalls itself.
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};

const remember = (owner: string, kind: RememberInput['kind'], text: string): RememberInput =>
  ({ owner_id: owner, session_id: 's1', kind, text });
const fact = (owner: string, key: string, text: string): ReplaceFactInput =>
  ({ owner_id: owner, session_id: 's1', key, text, payload: { key, value: text } });

describe('memory2 adapter — the old MemoryModule contract over memory2', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2adapter-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('remember returns a MemoryRow in the old shape (owner_id/kind/created_at)', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.remember(remember('o1', 'observation', 'added a logout route'));
      expect(row.owner_id).toBe('o1');
      expect(row.kind).toBe('observation');
      expect(row.text).toBe('added a logout route');
      expect(row.superseded).toBe(false);
      expect(typeof row.created_at).toBe('string');
      expect(row.id).toBeTruthy();
    } finally { await a.close(); }
  });

  it('recall returns MemoryMatch[] (MemoryRow + similarity), episodes only', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await a.remember(remember('o1', 'observation', 'added a logout route'));
      await a.remember(remember('o1', 'action', 'ran the tests'));
      const hits = await a.recall({ query: 'added a logout route', ownerId: 'o1', k: 5 });
      expect(hits.map((h) => h.text)).toContain('added a logout route');
      expect(hits.every((h) => typeof h.similarity === 'number')).toBe(true);
      expect(hits.every((h) => h.kind !== 'fact')).toBe(true);
    } finally { await a.close(); }
  });

  it('replaceFact + getProfile: one active fact per key, returned as MemoryRows', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await a.replaceFact(fact('o1', 'pkg', 'uses npm'));
      const row = await a.replaceFact(fact('o1', 'pkg', 'uses pnpm'));
      expect(row.kind).toBe('fact');
      const profile = await a.getProfile('o1');
      expect(profile.map((f) => f.text)).toEqual(['uses pnpm']); // exactly one active, the latest
    } finally { await a.close(); }
  });

  it('recall.similarity is the RAW cosine (the old MemoryMatch contract), not the blended rank', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await a.remember(remember('o1', 'observation', 'alpha apples')); // 'a' -> one dimension
      await a.remember(remember('o1', 'observation', 'zebra zone')); // 'z' -> an orthogonal dimension
      const hits = await a.recall({ query: 'alpha apples', ownerId: 'o1', k: 5 });
      const top = hits.find((h) => h.text === 'alpha apples');
      expect(top?.similarity).toBeCloseTo(1, 5); // identical text -> cosine 1 (raw), not a normalized blend score
    } finally { await a.close(); }
  });

  it('recall validates inputs like the old contract (blank query/owner, non-positive k)', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await expect(a.recall({ query: '  ', ownerId: 'o1' })).rejects.toThrow(/query/i);
      await expect(a.recall({ query: 'x', ownerId: '' })).rejects.toThrow(/owner/i);
      await expect(a.recall({ query: 'x', ownerId: 'o1', k: 0 })).rejects.toThrow(/positive integer/i);
    } finally { await a.close(); }
  });

  it('remember validates inputs (blank owner/text) like the old contract', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await expect(a.remember({ owner_id: '', session_id: 's1', kind: 'observation', text: 'x' })).rejects.toThrow(/owner/i);
      await expect(a.remember({ owner_id: 'o1', session_id: 's1', kind: 'observation', text: '  ' })).rejects.toThrow(/text/i);
    } finally { await a.close(); }
  });

  it('remember rejects facts (facts must go through replaceFact)', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await expect(a.remember(remember('o1', 'fact', 'sneaky'))).rejects.toThrow(/replaceFact/);
    } finally { await a.close(); }
  });

  it('supersede hides a fact from getProfile', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'pkg', 'uses npm'));
      await a.supersede(row.id);
      expect(await a.getProfile('o1')).toEqual([]);
    } finally { await a.close(); }
  });

  it('is owner-scoped — recall and getProfile never leak across owners', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await a.remember(remember('o1', 'observation', 'mine'));
      await a.remember(remember('o2', 'observation', 'theirs'));
      await a.replaceFact(fact('o2', 'pkg', 'theirs-fact'));
      expect((await a.recall({ query: 'mine', ownerId: 'o1', k: 5 })).map((h) => h.text)).toEqual(['mine']);
      expect(await a.getProfile('o1')).toEqual([]);
    } finally { await a.close(); }
  });

  it('persists across launches (cross-launch durability via files-as-truth)', async () => {
    const first = await createMemory2Adapter({ dir, embed, dim: DIM });
    await first.remember(remember('o1', 'observation', 'remembered before restart'));
    await first.replaceFact(fact('o1', 'pkg', 'uses npm'));
    await first.close();

    const second = await createMemory2Adapter({ dir, embed, dim: DIM }); // fresh process, same dir
    try {
      expect((await second.recall({ query: 'remembered before restart', ownerId: 'o1', k: 5 })).map((h) => h.text))
        .toContain('remembered before restart');
      expect((await second.getProfile('o1')).map((f) => f.text)).toEqual(['uses npm']);
    } finally { await second.close(); }
  });
});
