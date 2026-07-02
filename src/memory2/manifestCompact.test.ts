import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';
import { compactManifest, shouldCompactManifest } from './manifestCompact';
import { readManifest, nextSeq, manifestPath } from './manifest';

const DIM = 16;
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};

describe('manifestCompact — seq-preserving bounded-journal compaction', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2compact-')); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('collapses per-file overwrite chains, keeps superseded-fact puts, and NEVER renumbers seqs', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' }); // seq 1
    await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' }); // seq 2 (overwrite)
    await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' }); // seq 3 (overwrite)
    await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'helix' }); // seq 4 — supersedes
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'an episode' }); // seq 5
    await store.close();

    const before = await readManifest(dir);
    const beforeSeqs = new Set(before.map((o) => o.seq));
    const { after } = await compactManifest(dir);
    const kept = await readManifest(dir);
    expect(after).toBeLessThan(before.length);
    // seq preservation: every kept op keeps its ORIGINAL seq (a subset, ascending, no renumbering)
    expect(kept.every((o) => beforeSeqs.has(o.seq))).toBe(true);
    expect(kept.map((o) => o.seq)).toEqual([...kept.map((o) => o.seq)].sort((a, b) => a - b));
    // the superseded fact survives as ONE entry-carrying op (its last overwrite), not its whole chain
    const bySeq = new Map(kept.map((o) => [o.seq, o]));
    expect(bySeq.has(3)).toBe(true); // the collapsed chain winner (stored + hidden is live state)
    expect(bySeq.has(1)).toBe(false); // birth + first reinforce collapsed away
    expect(bySeq.has(2)).toBe(false);
    expect(bySeq.has(4)).toBe(true); // the active fact
    expect(bySeq.has(5)).toBe(true); // the episode

    // and the compacted manifest replays to the SAME live state (superseded hidden, active shown)
    const reopened = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await reopened.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
      expect((await reopened.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toEqual(['an episode']);
    } finally { await reopened.close(); }
  });

  it('pins nextSeq: the globally max-seq op survives even when its op-pair would drop', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    const f = await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' }); // seq 1
    await store.forget({ tier: 'fact', id: f.id, ownerId: 'o1' }); // seq 2 — file unlinked
    await store.close();

    expect(await nextSeq(dir)).toBe(3);
    await compactManifest(dir);
    const kept = await readManifest(dir);
    // the tombstoned pair drops (file confirmed absent) EXCEPT the globally max-seq op, which pins nextSeq
    expect(kept.map((o) => ({ seq: o.seq, op: o.op }))).toEqual([{ seq: 2, op: 'delete' }]);
    expect(await nextSeq(dir)).toBe(3); // NOT regressed to 1 — no seq reuse across restarts

    const reopened = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      const e = await reopened.remember({ tier: 'episode', ownerId: 'o1', text: 'later' });
      expect(e.seq).toBe(3); // fresh seq continues the old line
    } finally { await reopened.close(); }
  });

  it('tombstones stay permanent through compaction + reopen + reindex (no resurrection)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'old episode' });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'new episode' });
    await store.pruneEpisodes({ ownerId: 'o1', maxLive: 1, keepNewest: 1, maxAgeDays: 99999 }); // tombstones 'old'
    const f = await store.replaceFact({ ownerId: 'o1', factKey: 'k', text: 'a fact' });
    await store.forget({ tier: 'fact', id: f.id, ownerId: 'o1' });
    await store.close();

    await compactManifest(dir);
    const kept = await readManifest(dir);
    // the pruned EPISODE keeps its delete op (its JSONL line persists — the tombstone is what keeps it
    // dead); its put dropped. The forgotten FACT's pair is gone entirely (file confirmed absent).
    expect(kept.filter((o) => o.op === 'delete' && o.tier === 'episode').length).toBe(1);
    expect(kept.filter((o) => o.tier === 'fact').length).toBeLessThanOrEqual(1); // at most the max-seq pin

    const reopened = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await reopened.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['new episode']);
      expect(await reopened.getProfile('o1')).toEqual([]);
      await reopened.reindex(); // rebuild from files+manifest — must not resurrect either
      expect((await reopened.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['new episode']);
      expect(await reopened.getProfile('o1')).toEqual([]);
    } finally { await reopened.close(); }
  });

  it('crash atomicity: the rewrite goes through tmp; a stale tmp never corrupts the manifest', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'keep me' });
    await store.close();
    const original = await readManifest(dir);

    // Simulate a crash mid-compaction: a partial tmp exists, the original manifest is INTACT.
    writeFileSync(`${manifestPath(dir)}.tmp`, '{"seq":9999,"op":"put' /* torn */, 'utf8');
    expect(await readManifest(dir)).toEqual(original); // the original is untouched by the tmp

    const reopened = await createMemoryStore({ dir, embed, dim: DIM }); // opens from the original, ignores tmp
    try {
      expect((await reopened.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toEqual(['keep me']);
    } finally { await reopened.close(); }

    // the next compaction run replaces the stale tmp atomically
    await compactManifest(dir);
    expect(existsSync(`${manifestPath(dir)}.tmp`)).toBe(false);
    expect((await readManifest(dir)).length).toBeGreaterThan(0);
  });

  it('shouldCompactManifest: fires only past max(1000, 3×live)', () => {
    expect(shouldCompactManifest(1000, 1)).toBe(false);
    expect(shouldCompactManifest(1001, 1)).toBe(true);
    expect(shouldCompactManifest(1001, 400)).toBe(false); // 3×400 = 1200 > 1001
    expect(shouldCompactManifest(1201, 400)).toBe(true);
  });

  it('TRIGGER integration: a bloated journal compacts on open; state + nextSeq survive', async () => {
    const N = 520; // puts (N) + prune deletes (N-1) = 1039 ops > max(1000, 3×1)
    const s1 = await createMemoryStore({ dir, embed, dim: DIM });
    for (let i = 0; i < N; i++) await s1.remember({ tier: 'episode', ownerId: 'o1', text: `ep${i}` });
    await s1.pruneEpisodes({ ownerId: 'o1', maxLive: 1, keepNewest: 1, maxAgeDays: 99999, batchSize: 1000 });
    await s1.close();
    const before = await readManifest(dir);
    expect(before.length).toBe(2 * N - 1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s2 = await createMemoryStore({ dir, embed, dim: DIM }); // open triggers the compaction
    try {
      expect(warn.mock.calls.some((args) => /compacted the manifest/.test(String(args[0])))).toBe(true);
      const after = await readManifest(dir);
      expect(after.length).toBeLessThan(before.length);
      expect(after.length).toBe(N); // 1 live put + (N-1) log-tier tombstones (JSONL lines persist)
      expect((await s2.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual([`ep${N - 1}`]);
      const e = await s2.remember({ tier: 'episode', ownerId: 'o1', text: 'fresh' });
      expect(e.seq).toBe(2 * N); // nextSeq continues past the old max — never reused
    } finally { await s2.close(); }
  }, 60_000);
});
