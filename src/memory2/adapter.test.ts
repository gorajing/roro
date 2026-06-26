import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory2Adapter } from './adapter';
import { repoId } from './repoId';
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
  ({
    owner_id: owner,
    session_id: 's1',
    key,
    text,
    payload: { key, value: text, source: { session_id: 's1', turn_ts: 1718900000000 } },
  });

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

  it('forgetFact (M8): hard-deletes a fact so it leaves the profile — the Forget panel', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));
      expect((await a.getProfile('o1')).map((r) => r.text)).toContain('prefers vim');
      await a.forgetFact('o1', row.id);
      expect((await a.getProfile('o1')).map((r) => r.text)).not.toContain('prefers vim'); // gone, not just hidden
    } finally { await a.close(); }
  });

  it('forgetFact is owner-scoped — cannot delete another owner\'s fact', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const mine = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));
      await a.forgetFact('o2', mine.id); // wrong owner — must be a no-op, not a cross-owner delete
      expect((await a.getProfile('o1')).map((r) => r.text)).toContain('prefers vim'); // still there
    } finally { await a.close(); }
  });

  it('profileFacts returns renderer-safe active fact views', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      await a.replaceFact(fact('o1', 'editor', 'prefers vim'));
      await a.replaceFact(fact('o2', 'editor', 'prefers nano'));

      const profile = await a.profileFacts('o1');

      expect(profile).toHaveLength(1);
      expect(profile[0]).toMatchObject({
        key: 'editor',
        value: 'prefers vim',
        text: 'prefers vim',
        source: { session_id: 's1', turn_ts: 1718900000000 },
      });
      expect(profile[0]).not.toHaveProperty('owner_id');
      expect(profile[0]).not.toHaveProperty('payload');
    } finally { await a.close(); }
  });

  it('fixFact replaces by active owner-scoped id and persists across reopen', async () => {
    const first = await createMemory2Adapter({ dir, embed, dim: DIM });
    const old = await first.replaceFact(fact('o1', 'editor', 'prefers vim'));
    const fixed = await first.fixFact('o1', old.id, 'prefers zed');
    expect(fixed).toMatchObject({ key: 'editor', value: 'prefers zed', text: 'prefers zed' });
    expect((await first.profileFacts('o1')).map((f) => f.text)).toEqual(['prefers zed']);
    await first.close();

    const second = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      expect((await second.profileFacts('o1')).map((f) => f.text)).toEqual(['prefers zed']);
    } finally { await second.close(); }
  });

  it('fixFact rejects blank values and wrong-owner ids without mutating', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));

      await expect(a.fixFact('o1', row.id, '   ')).rejects.toThrow(/non-empty/i);
      await expect(a.fixFact('o2', row.id, 'prefers zed')).rejects.toThrow(/no longer available/i);

      expect((await a.profileFacts('o1')).map((f) => f.text)).toEqual(['prefers vim']);
    } finally { await a.close(); }
  });

  it('fixFact embed failure leaves the old active fact intact', async () => {
    const flaky = async (t: string): Promise<number[]> => {
      if (t === 'FAIL') throw new Error('embed down');
      return embed(t);
    };
    const a = await createMemory2Adapter({ dir, embed: flaky, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));

      await expect(a.fixFact('o1', row.id, 'FAIL')).rejects.toThrow('embed down');

      expect((await a.profileFacts('o1')).map((f) => f.text)).toEqual(['prefers vim']);
    } finally { await a.close(); }
  });

  it('verifyFact reinforces by active owner-scoped id', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));

      const verified = await a.verifyFact('o1', row.id);

      expect(verified).toMatchObject({ id: row.id, key: 'editor', text: 'prefers vim' });
      expect(verified.confidence).toBeGreaterThan(row.confidence ?? 0);
    } finally { await a.close(); }
  });

  it('factSource returns safe provenance for an active owner-scoped fact', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      const row = await a.replaceFact(fact('o1', 'editor', 'prefers vim'));

      await expect(a.factSource('o1', row.id)).resolves.toEqual({
        id: row.id,
        source: { session_id: 's1', turn_ts: 1718900000000 },
      });
    } finally { await a.close(); }
  });

  it('repo-scoped recall (M5b): a same-repo memory outranks an equal cross-repo one in the blend', async () => {
    const a = await createMemory2Adapter({ dir, embed, dim: DIM });
    try {
      // All same first char → identical embedding → equal relevance, so the repo is the only differentiator.
      // A (repoA) + B (repoB) are the OLD pair we compare; C,D (newer) occupy the top-2 recency-guarantee
      // floor (memoryStore always front-loads the 2 newest), so A-vs-B is decided by the BLEND — where the
      // repoMatch boost lives. Repo-scoping is deliberately SUBORDINATE to the "what did we just do?" floor.
      await a.remember({ owner_id: 'o1', session_id: 's1', kind: 'observation', text: 'work note A', repo_path: '/repoA' });
      await a.remember({ owner_id: 'o1', session_id: 's1', kind: 'observation', text: 'work note B', repo_path: '/repoB' });
      await a.remember({ owner_id: 'o1', session_id: 's1', kind: 'observation', text: 'work note C', repo_path: '/repoB' });
      await a.remember({ owner_id: 'o1', session_id: 's1', kind: 'observation', text: 'work note D', repo_path: '/repoB' });
      const rank = (hits: { text: string }[], t: string): number => hits.findIndex((h) => h.text === t);

      const unscoped = await a.recall({ query: 'work query', ownerId: 'o1', k: 4 });
      expect(rank(unscoped, 'work note B')).toBeLessThan(rank(unscoped, 'work note A')); // B newer → B above A

      const scoped = await a.recall({ query: 'work query', ownerId: 'o1', k: 4, repoId: repoId('/repoA') });
      expect(rank(scoped, 'work note A')).toBeLessThan(rank(scoped, 'work note B')); // repoA boost flips A above B
      expect(scoped).toHaveLength(4); // a BOOST, not a filter — cross-repo memories still recall
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
