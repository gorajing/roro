// src/memory2/memoryStore.ts — the unified memory2 API (files-as-truth + derived index + embedder).
//
// Composes the durable write coordinator (store.ts), the PGlite-HNSW index (pgliteIndex.ts), and an
// injected embedder. Every write is SERIALIZED through one chain so the derived index is updated in
// manifest (seq) order. remember() commits durably (file+manifest) FIRST, then embeds + indexes, then
// advances a persistent reconciliation cursor (applied_seq). recall()/recent()/getProfile() read the
// derived index. On open we RECONCILE: replay manifest ops with seq > applied_seq, in order, advancing
// the cursor per op — a CONTIGUOUS cursor that survives deletes (a regressing max(seq) would skip or
// replay ops). A failed embed degrades gracefully (the row is indexed without a vector, marked failed),
// so one bad op never blocks the cursor or loses a memory.
//
// (Hybrid retrieval and the atomic replaceFact/supersede land in the next increments; facts must go
// through replaceFact — remember() rejects them so a duplicate active fact can't be durably written
// before the index's unique constraint would reject it.)

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createMemoryWriter, type NewEntry } from './store';
import { createPgliteIndex } from './pgliteIndex';
import { readManifest } from './manifest';
import { readEpisodes } from './episodeLog';
import { readEntryFile, entryPath } from './entryFile';
import type { Entry } from './types';
import type { IndexStore, VectorMatch } from './indexStore';

const SCHEMA_VERSION = 1;

export type RememberInput = Omit<NewEntry, 'id' | 'schemaVersion' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export interface MemoryStore {
  /** Durably store a memory (episode/core/trace), then embed + index it. Facts go via replaceFact. */
  remember(input: RememberInput): Promise<Entry>;
  /** Episodic vector recall (excludes facts — those surface via getProfile), owner-scoped. */
  recall(opts: { query: string; ownerId: string; k?: number }): Promise<VectorMatch[]>;
  /** Most-recent episodes for an owner (the temporal/"what did we just do" path). */
  recent(opts: { ownerId: string; k?: number }): Promise<Entry[]>;
  /** Active profile facts for an owner ("KNOWN ABOUT THIS USER"), newest-first. */
  getProfile(ownerId: string): Promise<Entry[]>;
  close(): Promise<void>;
}

/** Index a put op's entry, degrading gracefully if the embedder is down (row stays usable, no vector). */
async function indexEntry(index: IndexStore, entry: Entry, embed: (t: string) => Promise<number[]>): Promise<void> {
  let embedding: number[] | undefined;
  if (entry.text.trim()) {
    try {
      embedding = await embed(entry.text);
    } catch (err) {
      console.warn(`[memory2] embed failed for ${entry.tier}/${entry.id} — indexed without a vector: ${(err as Error).message}`);
      entry = { ...entry, embeddingStatus: 'failed' };
    }
  }
  await index.upsert(entry, embedding);
}

/**
 * Replay manifest ops the index hasn't applied yet (files > manifest > DB), in seq order, advancing a
 * CONTIGUOUS persistent cursor per op. Survives deletes (cursor is not derived from row max) and never
 * skips a durable write whose prior index update failed.
 */
async function reconcile(dir: string, index: IndexStore, embed: (t: string) => Promise<number[]>): Promise<void> {
  const applied = await index.getAppliedSeq();
  const ops = (await readManifest(dir)).filter((o) => o.seq > applied).sort((a, b) => a.seq - b.seq);
  if (ops.length === 0) return;

  const logById = new Map<string, Entry>();
  for (const tier of ['episode', 'trace'] as const) {
    for (const e of await readEpisodes(dir, tier)) logById.set(e.id, e);
  }

  for (const op of ops) {
    if (op.op === 'delete') {
      await index.remove(op.id);
    } else {
      let entry: Entry | undefined;
      if (op.tier === 'episode' || op.tier === 'trace') {
        entry = logById.get(op.id);
      } else {
        try { entry = await readEntryFile(entryPath(dir, { tier: op.tier, id: op.id } as Entry)); } catch { entry = undefined; }
      }
      if (entry) await indexEntry(index, entry, embed);
      else console.warn(`[memory2] reconcile: no file for ${op.tier}/${op.id} (seq ${op.seq}) — files win, skipped`);
    }
    await index.setAppliedSeq(op.seq); // advance the contiguous cursor (processed, even if skipped/deleted)
  }
}

export async function createMemoryStore(opts: {
  dir: string;
  embed: (text: string) => Promise<number[]>;
  dim?: number;
  embedModel?: string;
}): Promise<MemoryStore> {
  const { dir, embed, dim, embedModel } = opts;
  const writer = createMemoryWriter({ dir });
  const index = await createPgliteIndex({ dataDir: join(dir, 'index'), dim });
  await reconcile(dir, index, embed);

  // Serialize the whole write path so the index is updated + the cursor advanced in seq order.
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const r = tail.then(fn, fn);
    tail = r.then(() => undefined, () => undefined);
    return r;
  }

  return {
    remember(input: RememberInput): Promise<Entry> {
      if (input.tier === 'fact') {
        return Promise.reject(new Error('memory2: remember() does not accept facts — use replaceFact (atomic supersede)'));
      }
      return serialize(async () => {
        const base: NewEntry = {
          ...input,
          id: input.id ?? randomUUID(),
          schemaVersion: SCHEMA_VERSION,
          createdAt: input.createdAt ?? new Date().toISOString(),
          embedModel: input.embedModel ?? embedModel,
          embedDim: input.embedDim ?? dim,
        };
        const entry = await writer.putEntry(base); // durable (file + manifest), assigns seq + contentHash
        await indexEntry(index, entry, embed);
        await index.setAppliedSeq(entry.seq ?? 0);
        return entry;
      });
    },

    async recall({ query, ownerId, k = 5 }): Promise<VectorMatch[]> {
      const embedding = await embed(query);
      return index.vectorSearch({ ownerId, embedding, k, tier: 'episode' });
    },

    async recent({ ownerId, k = 5 }): Promise<Entry[]> {
      return index.recent({ ownerId, k, tier: 'episode' });
    },

    async getProfile(ownerId: string): Promise<Entry[]> {
      return index.facts(ownerId);
    },

    async close(): Promise<void> {
      await index.close();
    },
  };
}
