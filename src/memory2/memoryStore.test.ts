import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';
import { createMemoryWriter } from './store';
import { appendOp } from './manifest';
import { readEntryFile, entryPath } from './entryFile';

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

  it('creates its data dir (and the index dir) when the path does not yet exist', async () => {
    // The production singleton points at <RORO_DB_DIR>/memory2 — a nested path that may not exist. The
    // store (not just the file-write helpers) must create it before PGlite opens the index subdir.
    const nested = join(dir, 'does', 'not', 'exist', 'yet');
    const store = await createMemoryStore({ dir: nested, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'created lazily' });
      expect((await store.recent({ ownerId: 'o1', k: 1 }))[0].text).toBe('created lazily');
    } finally { await store.close(); }
  });

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

  it('persists importance through remember -> recall (the M5 ranking-nudge channel)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      // The adapter stamps importanceFor(kind); here we prove the store carries it end-to-end so the blend
      // (memoryScore weights importance) can actually use it — a missing channel would silently drop the nudge.
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'added a logout route', importance: 6 });
      const hits = await store.recall({ query: 'added a logout route', ownerId: 'o1', k: 5 });
      expect(hits.find((h) => h.entry.text === 'added a logout route')?.entry.importance).toBe(6);
    } finally { await store.close(); }
  });

  it('forget hard-deletes a fact that STAYS gone across reindex (the Forget durability invariant)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      const f = await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'prefers vim' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'lang', text: 'prefers typescript' }); // sibling, different key
      await store.forget({ tier: 'fact', id: f.id, ownerId: 'o1' });
      expect((await store.getProfile('o1')).map((e) => e.text)).not.toContain('prefers vim');
      await store.reindex(); // rebuild the index from files-as-truth — the tombstone must keep the fact gone
      const after = (await store.getProfile('o1')).map((e) => e.text);
      expect(after).not.toContain('prefers vim'); // NOT resurrected by the reindex
      expect(after).toContain('prefers typescript'); // a sibling fact survives
    } finally { await store.close(); }
  });

  it('forget rejects an unsafe (path-traversal) id before it can become a file path', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await expect(store.forget({ tier: 'fact', id: '../../etc/passwd', ownerId: 'o1' })).rejects.toThrow(/unsafe id/);
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
      // not lost: the recency channel still surfaces it in hybrid recall even with no vector
      expect((await store.recall({ query: 'anything else', ownerId: 'o1', k: 5 })).map((h) => h.entry.id)).toEqual(['e1']);
    } finally { await store.close(); }
  });

  it('a WAL put op carrying op.entry is crash-recoverable — reconcile materializes the missing file', async () => {
    // An id-stable overwrite (supersede/reinforce) is WAL-FIRST: the put op carries op.entry as the commit
    // point + redo payload. Simulate a crash after the WAL append but BEFORE the file write — reconcile
    // must redo it from op.entry (no file/manifest divergence, no lost update).
    const entry = {
      id: 'f1', schemaVersion: 1, tier: 'fact' as const, ownerId: 'o1', factKey: 'editor',
      text: 'redone from the WAL', payload: { key: 'editor', value: 'redone from the WAL' },
      createdAt: '2026-06-22T00:00:00.000Z', seq: 1, contentHash: 'h', confidence: 0.5,
    };
    await appendOp(dir, { seq: 1, op: 'put', id: 'f1', tier: 'fact', ownerId: 'o1', contentHash: 'h', ts: entry.createdAt, entry });
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['redone from the WAL']); // redone
    } finally { await store.close(); }
    expect((await readEntryFile(entryPath(dir, entry))).text).toBe('redone from the WAL'); // file materialized
  });

  it('WAL redo overwrites a STALE existing file (crash after the WAL append, old file still present)', async () => {
    const writer = createMemoryWriter({ dir });
    await writer.putEntry({ id: 'f1', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'editor', text: 'old value', payload: { key: 'editor', value: 'old value' }, createdAt: '2026-06-22T00:00:00.000Z' }); // seq 1, file written
    // Simulate an overwrite crash: a NEWER WAL put op (seq 2) is appended, but the file is NOT rewritten
    // (the stale 'old value' file remains). A missing-only redo would leave files-as-truth diverged.
    const fresh = { id: 'f1', schemaVersion: 1, tier: 'fact' as const, ownerId: 'o1', factKey: 'editor', text: 'new value', payload: { key: 'editor', value: 'new value' }, createdAt: '2026-06-22T00:01:00.000Z', seq: 2, contentHash: 'h2' };
    await appendOp(dir, { seq: 2, op: 'put', id: 'f1', tier: 'fact', ownerId: 'o1', contentHash: 'h2', ts: fresh.createdAt, entry: fresh });
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['new value']);
    } finally { await store.close(); }
    expect((await readEntryFile(entryPath(dir, fresh))).text).toBe('new value'); // the stale file was overwritten (no divergence)
  });

  it('cross-launch: superseding an EPISODE reconciles correctly (log rows matched by seq, not id)', async () => {
    const s1 = await createMemoryStore({ dir, embed, dim: DIM });
    const ep1 = await s1.remember({ tier: 'episode', ownerId: 'o1', text: 'first thing' });
    await s1.remember({ tier: 'episode', ownerId: 'o1', text: 'second thing' });
    await s1.supersede(ep1.id); // appends a superseded row for ep1 (a NEW seq, same id)
    await s1.close();
    const s2 = await createMemoryStore({ dir, embed, dim: DIM }); // reconcile must match each op to its exact row by seq
    try {
      expect((await s2.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['second thing']); // ep1 hidden
    } finally { await s2.close(); }
  });

  it('hybrid recall surfaces recent work even when the query is phrased unlike it (the original bug, fixed)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'create a file greet.js' });
      // "what did we just do?" embeds far from "create…" — pure cosine + a 0.3 floor returned NOTHING (the bug).
      const hits = await store.recall({ query: 'what did we just do?', ownerId: 'o1', k: 5 });
      expect(hits.map((h) => h.entry.text)).toContain('create a file greet.js'); // recency surfaces it
    } finally { await store.close(); }
  });

  it('temporal recall surfaces the newest episode even amid many strong cosine matches (competition)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      for (let i = 0; i < 5; i++) await store.remember({ tier: 'episode', ownerId: 'o1', text: `topic detail ${i}` });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'newest unrelated thing' });
      const hits = await store.recall({ query: 'topic detail', ownerId: 'o1', k: 3 });
      expect(hits.map((h) => h.entry.text)).toContain('newest unrelated thing'); // recency-guaranteed slot
    } finally { await store.close(); }
  });

  it('replaceFact: exactly one active fact per key; a replacement supersedes the prior value', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'uses npm', payload: { key: 'pkg', value: 'npm' } });
      await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm', payload: { key: 'pkg', value: 'pnpm' } });
      const profile = await store.getProfile('o1');
      expect(profile.map((f) => f.text)).toEqual(['uses pnpm']); // only the new active value
    } finally { await store.close(); }
  });

  it('replaceFact is owner-scoped (does not touch another owner\'s same-key fact)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'mine' });
      await store.replaceFact({ ownerId: 'o2', factKey: 'pkg', text: 'theirs' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'mine v2' });
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['mine v2']);
      expect((await store.getProfile('o2')).map((f) => f.text)).toEqual(['theirs']);
    } finally { await store.close(); }
  });

  it('replaceFact embed failure leaves the prior fact active (abort-safe — embed before any write)', async () => {
    const flaky = async (t: string): Promise<number[]> => { if (t === 'FAIL') throw new Error('embed down'); return embed(t); };
    const store = await createMemoryStore({ dir, embed: flaky, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'good value' });
      await expect(store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'FAIL' })).rejects.toThrow();
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['good value']); // unchanged
    } finally { await store.close(); }
  });

  it('replaceFact is crash-recoverable via the WAL (reconcile completes a partially-applied replace)', async () => {
    const writer = createMemoryWriter({ dir });
    const prior = await writer.putEntry({ id: 'p1', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'pkg', text: 'uses npm', payload: { key: 'pkg', value: 'npm' }, createdAt: '2026-06-22T00:00:00.000Z' });
    // Commit a replace via the WAL (appends the compound op + materializes files) but DO NOT touch the
    // index — simulating a crash after the durable commit, before indexing.
    await writer.commitReplaceFact(
      { id: 'p2', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm', payload: { key: 'pkg', value: 'pnpm' }, createdAt: '2026-06-22T00:01:00.000Z' },
      [prior.id],
    );
    const store = await createMemoryStore({ dir, embed, dim: DIM }); // reconcile replays put + replace_fact
    try {
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['uses pnpm']); // exactly one active, the fresh value
    } finally { await store.close(); }
  });

  it('replaceFact WAL redo materializes the fresh file when a crash hit before file writes', async () => {
    const writer = createMemoryWriter({ dir });
    const prior = await writer.putEntry({ id: 'p1', schemaVersion: 1, tier: 'fact', ownerId: 'o1', factKey: 'pkg', text: 'uses npm', payload: { key: 'pkg', value: 'npm' }, createdAt: '2026-06-22T00:00:00.000Z' });
    // Simulate a crash AFTER the WAL op was appended but BEFORE files were materialized: append the
    // compound op directly, with no fresh file and the prior file still active.
    const fresh = { id: 'p2', schemaVersion: 1, tier: 'fact' as const, ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm', payload: { key: 'pkg', value: 'pnpm' }, createdAt: '2026-06-22T00:01:00.000Z', seq: 2 };
    await appendOp(dir, { seq: 2, op: 'replace_fact', id: 'p2', tier: 'fact', ownerId: 'o1', ts: fresh.createdAt, entry: fresh, supersedeIds: [prior.id] });
    const store = await createMemoryStore({ dir, embed, dim: DIM }); // reconcile must redo: write fresh file + supersede prior
    try {
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['uses pnpm']);
    } finally { await store.close(); }
    // the fresh file was materialized by reconcile (files-as-truth restored)
    expect((await readEntryFile(entryPath(dir, fresh))).text).toBe('uses pnpm');
  });

  it('supersede hides a fact from getProfile', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      const f = await store.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'uses npm' });
      await store.supersede(f.id);
      expect(await store.getProfile('o1')).toEqual([]);
    } finally { await store.close(); }
  });

  it('recall falls back to recency when the QUERY embed fails (never empty while recent rows exist)', async () => {
    const failingQuery = async (t: string): Promise<number[]> => { if (t === 'EMBED_FAIL') throw new Error('embed down'); return embed(t); };
    const store = await createMemoryStore({ dir, embed: failingQuery, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'something happened' });
      const hits = await store.recall({ query: 'EMBED_FAIL', ownerId: 'o1', k: 5 });
      expect(hits.map((h) => h.entry.text)).toEqual(['something happened']); // recency fallback, not empty
    } finally { await store.close(); }
  });
});
