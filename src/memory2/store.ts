// src/memory2/store.ts — the memory2 write coordinator (the files-as-truth contract, in code).
//
// All writes go through ONE serialized queue (single-writer), so the crash-safe ordered commit is an
// API boundary, not a comment: allocate seq -> write the durable content (per-file for core/fact,
// JSONL append for episode/trace) -> append the manifest op. The serialization also makes seq race-free
// (an in-memory counter seeded once from the manifest), fixing nextSeq's read-modify-write hazard.
//
// (The derived PGlite-HNSW index + startup reconciliation `files > manifest > DB` are the NEXT
// increment; this layer is the durable system of record they rebuild from.)

import { unlink } from 'node:fs/promises';
import { writeEntryFile, entryPath, computeContentHash } from './entryFile';
import { appendEpisode } from './episodeLog';
import { appendOp, nextSeq, type ManifestOp } from './manifest';
import type { Entry, Tier } from './types';

export type NewEntry = Omit<Entry, 'seq' | 'contentHash'>;

export interface MemoryWriter {
  /** Durably commit an entry (any tier): content first, then the manifest op. Assigns seq + contentHash. */
  putEntry(entry: NewEntry): Promise<Entry>;
  /** Tombstone (hard-delete intent): remove a durable entry's file + record a delete op. */
  deleteEntry(ref: { tier: Tier; id: string; ownerId: string }): Promise<void>;
}

const isLogTier = (t: Tier): boolean => t === 'episode' || t === 'trace';

export function createMemoryWriter(opts: { dir: string }): MemoryWriter {
  const { dir } = opts;
  let seqCounter: number | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  // Serialize every write through one chain (runs after the prior settles, success or failure).
  function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function allocSeq(): Promise<number> {
    if (seqCounter === null) seqCounter = await nextSeq(dir); // seed once; we are the single writer
    return seqCounter++;
  }

  return {
    putEntry(entry: NewEntry): Promise<Entry> {
      return run(async () => {
        const seq = await allocSeq();
        const contentHash = computeContentHash({ ...entry, seq } as Entry);
        const e: Entry = { ...entry, seq, contentHash };
        // 1) durable content first
        if (isLogTier(e.tier)) await appendEpisode(dir, e);
        else await writeEntryFile(dir, e);
        // 2) then the manifest op (the durability authority records the intent + order)
        const op: ManifestOp = {
          seq, op: 'put', id: e.id, tier: e.tier, ownerId: e.ownerId, contentHash, ts: e.createdAt,
        };
        await appendOp(dir, op);
        return e;
      });
    },

    deleteEntry(ref: { tier: Tier; id: string; ownerId: string }): Promise<void> {
      return run(async () => {
        const seq = await allocSeq();
        // Durable per-file entries are removed from disk; log-tier rows are tombstoned via the op
        // (reconciliation applies it — a JSONL line can't be edited in place).
        if (!isLogTier(ref.tier)) {
          await unlink(entryPath(dir, { tier: ref.tier, id: ref.id } as Entry)).catch(() => {});
        }
        await appendOp(dir, {
          seq, op: 'delete', id: ref.id, tier: ref.tier, ownerId: ref.ownerId, ts: new Date().toISOString(),
        });
      });
    },
  };
}
