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
import { writeEntryFile, readEntryFile, entryPath, computeContentHash, canonicalContent } from './entryFile';
import { appendEpisode } from './episodeLog';
import { appendOp, nextSeq, type ManifestOp } from './manifest';
import { sealEntry, type Cipher } from './cipher';
import type { Entry, Tier } from './types';

export type NewEntry = Omit<Entry, 'seq' | 'contentHash'>;

export interface MemoryWriter {
  /** Durably commit an entry (any tier): content first, then the manifest op. Assigns seq + contentHash. */
  putEntry(entry: NewEntry): Promise<Entry>;
  /** Tombstone (hard-delete intent): remove a durable entry's file + record a delete op. Returns the
   *  op's seq so a store-level prune can advance the reconciliation cursor (applied_seq) honestly. */
  deleteEntry(ref: { tier: Tier; id: string; ownerId: string }): Promise<number>;
  /**
   * Atomically replace the active fact for a key: a compound WAL op (carrying the fresh content + the
   * prior ids) is appended + fsync'd FIRST (the commit point), THEN files are materialized (supersede
   * priors, write fresh). A crash after the WAL is completed by reconcile (redo from op.entry), so the
   * "never zero active facts" guarantee holds. Returns the fresh entry + the superseded priors (to index).
   */
  commitReplaceFact(fresh: NewEntry, supersedeIds: string[]): Promise<{ fresh: Entry; superseded: Entry[] }>;
  /**
   * WAL-FIRST id-stable overwrite for a per-file entry (supersede/reinforce): the put op carries the
   * entry as the redo payload and is appended FIRST (the commit point), THEN the file is overwritten.
   * A crash after the WAL self-heals via reconcile (redo from op.entry) — so an in-place fact update can
   * never leave the file ahead of the manifest (no divergence, no seq reuse). Per-file tiers only.
   */
  commitOverwrite(entry: NewEntry): Promise<Entry>;
}

const isLogTier = (t: Tier): boolean => t === 'episode' || t === 'trace';

export function createMemoryWriter(opts: { dir: string; cipher?: Cipher }): MemoryWriter {
  const { dir, cipher } = opts;
  let seqCounter: number | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  // Stamp the keyed (HMAC) fingerprint when encrypting, else the plaintext SHA-256. Computed over the
  // PLAINTEXT canonical (before sealing), so it's stable regardless of encryption / key rotation.
  function fingerprint(plain: Entry): string {
    return cipher ? cipher.fingerprint(canonicalContent(plain)) : computeContentHash(plain);
  }
  // Seal content for at-rest storage (no-op when encryption is off). Must run AFTER seq is assigned
  // (seq is bound into the AAD).
  const seal = (e: Entry): Entry => (cipher ? sealEntry(e, cipher) : e);

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
      // A fact MUST carry a factKey: the single-active-fact unique index is partial on fact_key, and
      // Postgres allows multiple NULLs — so a keyless fact would silently escape the invariant.
      if (entry.tier === 'fact' && !entry.factKey) {
        return Promise.reject(
          new Error('memory2: a fact entry requires a factKey (the single-active-fact invariant)'),
        );
      }
      return run(async () => {
        const seq = await allocSeq();
        // Hash over PLAINTEXT, then seal (seq is assigned first — it's bound into the seal's AAD).
        const plain: Entry = { ...entry, seq, contentHash: fingerprint({ ...entry, seq } as Entry) };
        const e: Entry = seal(plain);
        // 1) durable content first (SEALED at rest)
        if (isLogTier(e.tier)) await appendEpisode(dir, e);
        else await writeEntryFile(dir, e);
        // 2) then the manifest op (the durability authority records the intent + order)
        const op: ManifestOp = {
          seq, op: 'put', id: e.id, tier: e.tier, ownerId: e.ownerId, contentHash: e.contentHash, ts: e.createdAt,
        };
        await appendOp(dir, op);
        return e; // SEALED — the caller (memoryStore) opens it for the API / embedding
      });
    },

    commitReplaceFact(fresh: NewEntry, supersedeIds: string[]): Promise<{ fresh: Entry; superseded: Entry[] }> {
      return run(async () => {
        const seq = await allocSeq();
        // Hash over PLAINTEXT, then seal — the WAL op.entry + fresh file are SEALED at rest.
        const freshEntry: Entry = seal({ ...fresh, seq, contentHash: fingerprint({ ...fresh, seq } as Entry) });
        // 1) WAL: append the compound op FIRST (carries sealed fresh content + prior ids) — the commit point.
        await appendOp(dir, {
          seq, op: 'replace_fact', id: freshEntry.id, tier: 'fact', ownerId: freshEntry.ownerId,
          contentHash: freshEntry.contentHash, ts: freshEntry.createdAt, entry: freshEntry, supersedeIds,
        });
        // 2) Materialize (idempotent, redoable from the WAL): supersede prior files, then write the fresh one.
        const superseded: Entry[] = [];
        for (const pid of supersedeIds) {
          try {
            const prior = await readEntryFile(entryPath(dir, { tier: 'fact', id: pid } as Entry));
            const sup: Entry = { ...prior, superseded: true, updatedAt: freshEntry.createdAt };
            await writeEntryFile(dir, sup);
            superseded.push(sup);
          } catch {
            /* prior file already gone (idempotent redo) — fine */
          }
        }
        await writeEntryFile(dir, freshEntry);
        return { fresh: freshEntry, superseded };
      });
    },

    commitOverwrite(entry: NewEntry): Promise<Entry> {
      if (isLogTier(entry.tier)) {
        return Promise.reject(new Error('memory2: commitOverwrite is for per-file tiers only (logs are append-only)'));
      }
      if (entry.tier === 'fact' && !entry.factKey) {
        return Promise.reject(new Error('memory2: a fact entry requires a factKey (the single-active-fact invariant)'));
      }
      return run(async () => {
        const seq = await allocSeq();
        const e: Entry = seal({ ...entry, seq, contentHash: fingerprint({ ...entry, seq } as Entry) });
        // 1) WAL-first: the put op carries op.entry (the redo payload) and is the commit point.
        await appendOp(dir, { seq, op: 'put', id: e.id, tier: e.tier, ownerId: e.ownerId, contentHash: e.contentHash, ts: e.createdAt, entry: e });
        // 2) Then overwrite the file (idempotent, redoable from the WAL — no file/manifest divergence).
        await writeEntryFile(dir, e);
        return e;
      });
    },

    deleteEntry(ref: { tier: Tier; id: string; ownerId: string }): Promise<number> {
      return run(async () => {
        const seq = await allocSeq();
        // Durable per-file entries are removed from disk; log-tier rows are tombstoned via the op
        // (reconciliation applies it — a JSONL line can't be edited in place).
        if (!isLogTier(ref.tier)) {
          await unlink(entryPath(dir, { tier: ref.tier, id: ref.id } as Entry)).catch(() => { /* best-effort: an already-missing file is fine (the op tombstone is the source of truth) */ });
        }
        await appendOp(dir, {
          seq, op: 'delete', id: ref.id, tier: ref.tier, ownerId: ref.ownerId, ts: new Date().toISOString(),
        });
        return seq;
      });
    },
  };
}
