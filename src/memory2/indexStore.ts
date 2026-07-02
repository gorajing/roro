// src/memory2/indexStore.ts — the swappable derived-index seam.
//
// Files are the source of truth; the IndexStore is a DERIVED, rebuildable cache that serves the fast
// read paths (vector KNN, recency, active facts). Keeping it behind this interface is what makes the
// engine choice reversible: v1 shipped PGlite+pgvector HNSW; the corpus is self-capped (~5k/owner,
// single local user), so the current engine is a pure in-memory scan (memIndex.ts) rebuilt from the
// manifest every open, with embeddings persisted by the vectorCache sidecar. A future swap is just
// another impl + a reindex from files (indexStoreConformance.ts is the contract).

import type { Entry, Tier } from './types';

export interface VectorMatch {
  entry: Entry;
  similarity: number; // cosine, 1 = identical
}

export interface IndexStore {
  /** Insert or replace (by id) a derived row, with its embedding (omit for un-embeddable rows). */
  upsert(entry: Entry, embedding?: number[]): Promise<void>;
  /** Owner-scoped vector KNN over live (non-superseded, non-deleted) rows, ranked by cosine. */
  vectorSearch(opts: { ownerId: string; embedding: number[]; k: number; tier?: Tier }): Promise<VectorMatch[]>;
  /** Owner-scoped most-recent live rows by seq (the temporal/working path). */
  recent(opts: { ownerId: string; k: number; tier?: Tier }): Promise<Entry[]>;
  /** Ids of the oldest live EPISODES to prune (corpus bounding): per owner, beyond `keepNewest` AND
   *  (beyond `maxLive` OR older than `maxAgeCutoff`). Oldest first, capped at `batchSize`. ownerId omitted
   *  ⇒ all owners (per-owner caps via partition). Never returns facts/core. */
  episodesToPrune(opts: { ownerId?: string; maxLive: number; maxAgeCutoff: string; keepNewest: number; batchSize: number }): Promise<Array<{ id: string; ownerId: string }>>;
  /** Active (non-superseded, non-deleted) profile facts for an owner, newest-first. */
  facts(ownerId: string): Promise<Entry[]>;
  /** Fetch a single row's entry by id (or undefined). */
  get(id: string): Promise<Entry | undefined>;
  /** Drop a row from the index (the file/manifest tombstone is the source of truth for "forget"). */
  remove(id: string): Promise<void>;
  /** Row count (for reconciliation/health checks). */
  count(): Promise<number>;
  /** Highest indexed seq among rows (0 if empty). NOT a reconciliation cursor (regresses on delete). */
  maxSeq(): Promise<number>;
  /** Persistent reconciliation cursor: the highest CONTIGUOUS manifest seq fully applied to the index. */
  getAppliedSeq(): Promise<number>;
  setAppliedSeq(seq: number): Promise<void>;
  /** Rebuild the index from a set of stored (possibly SEALED) entries — the "derived cache" property
   *  (engine/embed swap = reindex). `embedFor` receives each stored entry and returns {embedding} (caller
   *  opens/decrypts first), {} for an un-embeddable/empty row, or {failed:true} when the embedder is down
   *  (the row is indexed without a vector + stamped embeddingStatus:'failed', exactly like the incremental
   *  path) — or it may THROW to abort the whole rebuild. The doc is stored as-is (sealed); the vector is
   *  from plaintext. Atomic: embed-all-first, then delete+insert in one txn — a failure never empties it. */
  reindexFrom(entries: Iterable<Entry>, embedFor: (entry: Entry) => Promise<{ embedding?: number[]; failed?: boolean }>): Promise<void>;
  close(): Promise<void>;
}
