// src/memory2/memIndex.ts — the pure in-memory IndexStore engine (ZERO I/O).
//
// Replaces PGlite+pgvector behind the untouched IndexStore seam. The index was ALWAYS a derived,
// rebuildable cache over files-as-truth; this engine makes that literal: a flat Map rebuilt from the
// manifest on every open (no owner sharding — the corpus is self-capped ~5k/owner, single local user,
// so a linear scan beats an ANN index at this scale). Vectors are L2-normalized Float32Arrays at
// insert; the query is normalized once per search; similarity is a dot product with a float64
// accumulator (cosine parity with pgvector's float4 storage). Persistence of the EXPENSIVE part
// (embeddings) lives in the vectorCache sidecar, consulted by memoryStore — never in here.
//
// The reconciliation cursor (getAppliedSeq/setAppliedSeq) is EPHEMERAL by design: it starts at 0 on
// every open, so reconcile replays the FULL manifest every launch — rebuild-from-files is the NORMAL
// open path, exercised every single launch, not a rarely-run recovery mode.

import { l2Normalize } from './vectorCache';
import type { Entry, Tier } from './types';
import type { IndexStore, VectorMatch } from './indexStore';

interface Row {
  entry: Entry;
  vec?: Float32Array; // L2-normalized; absent = vectorless (un-embeddable or embed-failed)
}

const isLive = (e: Entry): boolean => !e.superseded && !e.deletedAt;

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0; // float64 accumulator
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** seq-descending comparator (newest first); missing seq sorts oldest (0). */
const bySeqDesc = (a: Entry, b: Entry): number => (b.seq ?? 0) - (a.seq ?? 0);

export function createMemIndex(opts: { dim?: number } = {}): IndexStore {
  const dim = opts.dim ?? 768;
  let rows = new Map<string, Row>();
  let appliedSeq = 0; // ephemeral — 0 at every open (full-manifest replay is the normal path)
  let warnedZeroNorm = false;

  function assertDim(embedding: ArrayLike<number>, what: string): void {
    if (embedding.length !== dim) {
      throw new Error(`memory2 memIndex: ${what} has dimension ${embedding.length} but the index is dimension ${dim}`);
    }
  }

  /** Normalize an embedding for storage; a zero-norm vector is treated as vectorless (warn once). */
  function toVec(embedding: number[] | undefined, id: string): Float32Array | undefined {
    if (!embedding) return undefined;
    assertDim(embedding, 'embedding');
    const vec = l2Normalize(embedding);
    let nonZero = false;
    for (let i = 0; i < vec.length; i++) if (vec[i] !== 0) { nonZero = true; break; }
    if (!nonZero) {
      if (!warnedZeroNorm) {
        warnedZeroNorm = true;
        console.warn(`[memory2] zero-norm embedding for ${id} — indexed without a vector (cosine is undefined on a zero vector)`);
      }
      return undefined;
    }
    return vec;
  }

  /** The single-active-fact structural invariant (the pglite partial-unique index, in code): at most
   *  one live fact row per (ownerId, factKey). THROWS like the unique-index violation did. */
  function assertActiveFactUnique(map: Map<string, Row>, entry: Entry): void {
    if (entry.tier !== 'fact' || !entry.factKey || !isLive(entry)) return;
    for (const { entry: other } of map.values()) {
      if (other.id !== entry.id && other.tier === 'fact' && isLive(other)
        && other.ownerId === entry.ownerId && other.factKey === entry.factKey) {
        throw new Error(
          `memory2 memIndex: duplicate active fact for (${entry.ownerId}, ${entry.factKey}) — ` +
            `the single-active-fact-per-key invariant forbids a second live row`,
        );
      }
    }
  }

  function live(ownerId: string | undefined, tier?: Tier): Row[] {
    const out: Row[] = [];
    for (const row of rows.values()) {
      const e = row.entry;
      if (!isLive(e)) continue;
      if (ownerId !== undefined && e.ownerId !== ownerId) continue;
      if (tier !== undefined && e.tier !== tier) continue;
      out.push(row);
    }
    return out;
  }

  return {
    async upsert(entry: Entry, embedding?: number[]): Promise<void> {
      assertActiveFactUnique(rows, entry);
      // Omitted embedding CLEARS a prior vector (pglite parity: `excluded.embedding` was null) — the
      // row's vector always reflects the LATEST upsert, never a stale text's.
      rows.set(entry.id, { entry, vec: toVec(embedding, `${entry.tier}/${entry.id}`) });
    },

    async vectorSearch({ ownerId, embedding, k, tier }): Promise<VectorMatch[]> {
      assertDim(embedding, 'query embedding');
      const q = l2Normalize(embedding); // normalized ONCE per search
      let nonZero = false;
      for (let i = 0; i < q.length; i++) if (q[i] !== 0) { nonZero = true; break; }
      if (!nonZero) return []; // cosine is undefined against a zero query
      const scored: VectorMatch[] = [];
      for (const row of live(ownerId, tier)) {
        if (!row.vec) continue;
        scored.push({ entry: row.entry, similarity: dot(q, row.vec) });
      }
      // Deterministic: similarity desc, then seq desc (newer wins a cosine tie).
      return scored
        .sort((a, b) => b.similarity - a.similarity || bySeqDesc(a.entry, b.entry))
        .slice(0, k);
    },

    async recent({ ownerId, k, tier }): Promise<Entry[]> {
      return live(ownerId, tier).map((r) => r.entry).sort(bySeqDesc).slice(0, k);
    },

    async episodesToPrune({ ownerId, maxLive, maxAgeCutoff, keepNewest, batchSize }): Promise<Array<{ id: string; ownerId: string }>> {
      // Rank live episodes newest-first PER OWNER (rn), prune those past keepNewest that are also past
      // the count cap OR older than the age cutoff — the exact pglite window-function semantics.
      // createdAt is ISO text → lexical compare is chronological.
      const byOwner = new Map<string, Entry[]>();
      for (const row of live(ownerId, 'episode')) {
        const list = byOwner.get(row.entry.ownerId);
        if (list) list.push(row.entry);
        else byOwner.set(row.entry.ownerId, [row.entry]);
      }
      const victims: Array<{ id: string; ownerId: string; rn: number; seq: number }> = [];
      for (const entries of byOwner.values()) {
        entries.sort(bySeqDesc);
        for (let i = 0; i < entries.length; i++) {
          const rn = i + 1;
          if (rn > keepNewest && (rn > maxLive || entries[i].createdAt < maxAgeCutoff)) {
            victims.push({ id: entries[i].id, ownerId: entries[i].ownerId, rn, seq: entries[i].seq ?? 0 });
          }
        }
      }
      return victims
        .sort((a, b) => b.rn - a.rn || a.seq - b.seq) // oldest first (rn desc); seq asc breaks cross-owner ties
        .slice(0, batchSize)
        .map((v) => ({ id: v.id, ownerId: v.ownerId }));
    },

    async facts(ownerId: string): Promise<Entry[]> {
      return live(ownerId, 'fact').map((r) => r.entry).sort(bySeqDesc);
    },

    async get(id: string): Promise<Entry | undefined> {
      return rows.get(id)?.entry;
    },

    async remove(id: string): Promise<void> {
      rows.delete(id);
    },

    async count(): Promise<number> {
      return rows.size;
    },

    async maxSeq(): Promise<number> {
      let max = 0;
      for (const { entry } of rows.values()) if ((entry.seq ?? 0) > max) max = entry.seq ?? 0;
      return max;
    },

    async getAppliedSeq(): Promise<number> {
      return appliedSeq;
    },

    async setAppliedSeq(seq: number): Promise<void> {
      appliedSeq = seq;
    },

    async reindexFrom(entries: Iterable<Entry>, embedFor: (entry: Entry) => Promise<{ embedding?: number[]; failed?: boolean }>): Promise<void> {
      // Embed EVERYTHING into a staging map first; only then swap. If any embed (or invariant) throws,
      // the existing index is untouched — a failed rebuild never empties it.
      const staged = new Map<string, Row>();
      for (const entry of entries) {
        const r = await embedFor(entry);
        const e = r.failed ? { ...entry, embeddingStatus: 'failed' as const } : entry;
        assertActiveFactUnique(staged, e);
        staged.set(e.id, { entry: e, vec: toVec(r.embedding, `${e.tier}/${e.id}`) });
      }
      rows = staged; // atomic swap
    },

    async close(): Promise<void> {
      rows = new Map();
    },
  };
}
