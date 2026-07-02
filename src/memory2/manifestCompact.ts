// src/memory2/manifestCompact.ts — bounded-journal compaction for the manifest (seq-PRESERVING).
//
// Full-manifest replay is the NORMAL open path now, so the journal must not grow without bound
// (every prune/forget leaves a put+delete pair; every reinforce appends an overwrite op). Compaction
// rewrites the manifest down to what replay actually needs, under hard rules:
//
//   - NEVER renumber: kept ops keep their original seq (seq is the recency key, bound into sealed
//     entries' AAD, and matched to episode-log rows BY SEQ — renumbering would corrupt all three).
//   - Drop op-pairs for tombstoned ids. The delete op itself is dropped ONLY when no put survives
//     AND the content is confirmed gone: per-file tiers require the file absent on disk; log tiers
//     keep their delete op (the JSONL line persists — the tombstone is what keeps it dead).
//   - Collapse a PER-FILE overwrite chain (reinforce/supersede/core re-puts) to its max-seq
//     entry-carrying op (the WAL redo payload replays the final state alone). Log-tier put chains
//     are kept as-is (each op matches its own JSONL row by seq).
//   - KEEP superseded-fact puts (stored + hidden is live state, not garbage).
//   - ALWAYS retain the globally max-seq op, even if the rules would drop it — nextSeq() derives
//     from the manifest max, and losing it would REUSE seqs after a restart (corrupting recency and
//     AAD identity). A retained delete for an already-absent id replays as a no-op.
//   - Atomic rewrite: tmp → fsync → rename → fsync dir. A crash mid-compact leaves the original
//     manifest intact (a stale .tmp is ignored and overwritten by the next run).
//
// Trigger (evaluated on store open, inside the serialize chain): ops > max(1000, 3 × liveCount).

import { access, open as fsOpen, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { manifestPath, readManifest, type ManifestOp } from './manifest';
import { entryPath } from './entryFile';
import type { Entry, Tier } from './types';

const isLogTier = (t: Tier): boolean => t === 'episode' || t === 'trace';

/** The compaction trigger: the journal is way past what the live corpus justifies. */
export function shouldCompactManifest(opCount: number, liveCount: number): boolean {
  return opCount > Math.max(1000, 3 * liveCount);
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const fh = await fsOpen(dir, 'r');
    try { await fh.sync(); } finally { await fh.close(); }
  } catch { /* best-effort: the rename itself is atomic */ }
}

/** Decide which ops survive. Exposed for tests; does not touch disk except file-absence checks. */
async function planCompaction(dir: string, ops: ManifestOp[]): Promise<ManifestOp[]> {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq);
  const byId = new Map<string, ManifestOp[]>();
  for (const op of sorted) {
    const list = byId.get(op.id);
    if (list) list.push(op);
    else byId.set(op.id, [op]);
  }

  const keep: ManifestOp[] = [];
  for (const idOps of byId.values()) {
    const last = idOps[idOps.length - 1];
    if (last.op === 'delete') {
      // Tombstoned id: every put drops. The delete drops too ONLY when the content is confirmed gone
      // (per-file tier + file absent); a log tier's JSONL line persists, so its tombstone must persist.
      if (isLogTier(last.tier) || await fileExists(entryPath(dir, { tier: last.tier, id: last.id } as Entry))) {
        keep.push(last);
      }
    } else if (isLogTier(last.tier)) {
      // Log-tier puts are kept as-is: each op matches its own committed JSONL row by seq (a supersede
      // chain needs the final row indexed; interior deletes in a mixed history stay dropped).
      for (const op of idOps) if (op.op !== 'delete') keep.push(op);
    } else {
      // Per-file tier, finally live: collapse the overwrite chain to the max-seq ENTRY-CARRYING op
      // (the redo payload alone reproduces the final state). A single born-by-putEntry op carries no
      // entry — then the (existing) file is the content source and the last op suffices.
      const carriers = idOps.filter((op) => op.op !== 'delete' && op.entry);
      const winner = carriers.length > 0 ? carriers[carriers.length - 1] : last;
      keep.push(winner);
      if (winner !== last && !last.entry && last.seq > winner.seq) keep.push(last); // defensive: never drop a NEWER op than the kept one
    }
  }

  // Pin nextSeq: the globally max-seq op must survive even if the rules dropped it.
  const globalMax = sorted[sorted.length - 1];
  if (globalMax && !keep.includes(globalMax)) keep.push(globalMax);

  return keep.sort((a, b) => a.seq - b.seq);
}

/** Rewrite the manifest to its compacted form (atomic tmp → fsync → rename → fsync dir).
 *  MUST run with no concurrent writer (the store serializes it into the write chain on open). */
export async function compactManifest(dir: string): Promise<{ before: number; after: number }> {
  const ops = await readManifest(dir);
  const keep = await planCompaction(dir, ops);
  const path = manifestPath(dir);
  const tmp = `${path}.tmp`;
  const fh = await fsOpen(tmp, 'w');
  try {
    await fh.writeFile(keep.map((op) => `${JSON.stringify(op)}\n`).join(''), 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path); // the commit point — a crash before this leaves the original intact
  await fsyncDir(dirname(path));
  return { before: ops.length, after: keep.length };
}
