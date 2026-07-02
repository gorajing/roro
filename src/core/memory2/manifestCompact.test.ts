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

  it('collapses per-file NON-FACT chains, keeps the FULL fact history, and NEVER renumbers seqs', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'core', id: 'c1', ownerId: 'o1', text: 'core v1' }); // seq 1 (overwrite chain…)
    await store.remember({ tier: 'core', id: 'c1', ownerId: 'o1', text: 'core v2' }); // seq 2
    await store.remember({ tier: 'core', id: 'c1', ownerId: 'o1', text: 'core v3' }); // seq 3 — the chain winner
    await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' }); // seq 4: fact A
    await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'helix' }); // seq 5: fact B supersedes A
    await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' }); // seq 6 (overwrite of B)
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'an episode' }); // seq 7
    await store.close();

    const before = await readManifest(dir);
    const beforeSeqs = new Set(before.map((o) => o.seq));
    const { after } = await compactManifest(dir);
    const kept = await readManifest(dir);
    expect(after).toBeLessThan(before.length);
    // seq preservation: every kept op keeps its ORIGINAL seq (a subset, ascending, no renumbering)
    expect(kept.every((o) => beforeSeqs.has(o.seq))).toBe(true);
    expect(kept.map((o) => o.seq)).toEqual([...kept.map((o) => o.seq)].sort((a, b) => a - b));
    const bySeq = new Map(kept.map((o) => [o.seq, o]));
    // the CORE overwrite chain collapses to its max-seq entry-carrying op (state lives on its own id)
    expect(bySeq.has(1)).toBe(false);
    expect(bySeq.has(2)).toBe(false);
    expect(bySeq.has(3)).toBe(true);
    // FACT ops are exempt — the full history survives (the PR #147 P0: dropping any of them can brick
    // replay or resurrect a superseded value, because supersession lives on the successor's op)
    expect(bySeq.has(4)).toBe(true);
    expect(bySeq.has(5)).toBe(true);
    expect(bySeq.has(6)).toBe(true);
    expect(bySeq.has(7)).toBe(true); // the episode

    // and the compacted manifest replays to the SAME live state (superseded hidden, active shown)
    const reopened = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await reopened.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
      expect((await reopened.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toEqual(['an episode']);
    } finally { await reopened.close(); }
  });

  it('pins nextSeq: the globally max-seq op survives even when its op-pair would drop', async () => {
    // A CORE pair (facts are exempt from pair-dropping since the PR #147 P0): put + forget with the
    // file confirmed absent is the one shape whose ops would BOTH drop — the max-seq pin must hold.
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'core', id: 'c1', ownerId: 'o1', text: 'core note' }); // seq 1
    await store.forget({ tier: 'core', id: 'c1', ownerId: 'o1' }); // seq 2 — file unlinked
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
    // dead); its put dropped. The forgotten FACT keeps its FULL history (the PR #147 P0 exemption),
    // delete op last — replay applies the tombstone, so it stays dead.
    expect(kept.filter((o) => o.op === 'delete' && o.tier === 'episode').length).toBe(1);
    const factOps = kept.filter((o) => o.tier === 'fact');
    expect(factOps.map((o) => o.op)).toEqual(['replace_fact', 'delete']); // full history, tombstone retained

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

// THE PR #147 P0 (found by the review panel, reproduced by execution): commitReplaceFact records the
// prior fact's supersession ONLY on the SUCCESSOR's op (supersedeIds) — the prior's file is rewritten
// at its original seq with no new manifest op. So any compaction that drops that successor op (the old
// per-file chain collapse after a routine reinforce, or the tombstone pair-drop after a forget of the
// successor) leaves the prior's own op as its only trace — and replay indexes the prior's STALE WAL
// snapshot as ACTIVE: (1) a duplicate-active-fact throw inside reconcile bricked the store on EVERY
// subsequent launch (rm -rf index/ can't help — the manifest itself is the damage); (2) the forget
// variant RESURRECTED the superseded prior into the profile. These three tests are the permanent
// regression pins; the fix is planCompaction's fact-tier exemption (full op history, never collapsed).
describe('manifestCompact — replace_fact supersede ops survive compaction (the PR #147 P0)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2compact147-')); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('[P0-1] replace → replace → reinforce → compact → reopen serves the CURRENT value (no brick)', async () => {
    const s = await createMemoryStore({ dir, embed, dim: DIM });
    await s.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' }); // seq 1: A
    await s.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'helix' }); // seq 2: B supersedes A (A's supersession lives ONLY here)
    await s.reinforceFact({ ownerId: 'o1', factKey: 'editor' }); // seq 3: routine corroboration — an overwrite op for B
    expect((await s.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
    await s.close();

    await compactManifest(dir);
    // B's replace_fact op (the ONLY record that A is superseded) must survive the overwrite collapse.
    expect((await readManifest(dir)).some((o) => o.op === 'replace_fact' && (o.supersedeIds?.length ?? 0) > 0)).toBe(true);

    const r = await createMemoryStore({ dir, embed, dim: DIM }); // pre-fix: duplicate-active-fact THROW (bricked)
    try {
      expect((await r.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
    } finally { await r.close(); }
    const r2 = await createMemoryStore({ dir, embed, dim: DIM }); // and it STAYS healthy on the next launch
    try {
      expect((await r2.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
    } finally { await r2.close(); }
  });

  it('[P0-2] the ORGANIC 3-launch path: churn → auto-compact on open (launch 2) → launch 3 opens clean', async () => {
    // Launch 1: routine use — enough episode churn to arm the trigger, plus the dangerous fact shape
    // (replace, replace, reinforce: the supersede-carrying op is NOT the fact's last op).
    const N = 520;
    const s1 = await createMemoryStore({ dir, embed, dim: DIM });
    await s1.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' });
    await s1.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'helix' });
    await s1.reinforceFact({ ownerId: 'o1', factKey: 'editor' });
    for (let i = 0; i < N; i++) await s1.remember({ tier: 'episode', ownerId: 'o1', text: `ep${i}` });
    await s1.pruneEpisodes({ ownerId: 'o1', maxLive: 1, keepNewest: 1, maxAgeDays: 99999, batchSize: 1000 });
    await s1.close();

    // Launch 2: the bloated journal auto-compacts at the END of open (this launch itself is fine —
    // it replayed the PRE-compaction manifest).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s2 = await createMemoryStore({ dir, embed, dim: DIM });
    expect(warn.mock.calls.some((args) => /compacted the manifest/.test(String(args[0])))).toBe(true);
    expect((await s2.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
    await s2.close();

    // Launch 3: the first replay OF the compacted manifest — pre-fix this THREW (bricked forever).
    const s3 = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      expect((await s3.getProfile('o1')).map((f) => f.text)).toEqual(['helix']);
      expect((await s3.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual([`ep${N - 1}`]);
    } finally { await s3.close(); }
  }, 60_000);

  it('[P0-3] replace → replace → forget(successor) → compact → reopen: the profile stays EMPTY (no resurrection)', async () => {
    const s = await createMemoryStore({ dir, embed, dim: DIM });
    await s.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'vim' }); // seq 1: A
    const b = await s.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'helix' }); // seq 2: B supersedes A
    await s.forget({ tier: 'fact', id: b.id, ownerId: 'o1' }); // seq 3: hard-delete B
    expect((await s.getProfile('o1')).map((f) => f.text)).toEqual([]);
    await s.close();

    await compactManifest(dir);

    const r = await createMemoryStore({ dir, embed, dim: DIM }); // pre-fix: 'vim' RESURRECTED into the profile
    try {
      expect((await r.getProfile('o1')).map((f) => f.text)).toEqual([]);
      await r.reindex(); // and a full rebuild must not resurrect it either
      expect((await r.getProfile('o1')).map((f) => f.text)).toEqual([]);
    } finally { await r.close(); }
  });
});
