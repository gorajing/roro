// src/memory2/types.ts — the memory2 Entry model (files-as-truth system of record).
//
// One Entry per durable memory. Files are the source of truth; the index (PGlite+HNSW) is a derived,
// rebuildable cache. The full field set is designed in NOW so the moat features (consolidation,
// forgetting, confidence, tracing, encryption, hard-delete) never require a migration — and with
// files-as-truth, even a schema change is just a reindex.

/** The four physical tiers (Codex: keep v1 minimal; "working set" is a query, "graph" is reserved). */
export type Tier = 'core' | 'fact' | 'episode' | 'trace';

/** Structured payload for the `fact` tier (typed so the single-active-fact invariant can be structural). */
export interface FactPayload {
  key: string;
  value: string;
  source?: { sessionId?: string; turnTs?: number };
}

export interface Entry {
  id: string;
  /** bump when the on-disk shape changes; reconciliation/reindex keys off this. */
  schemaVersion: number;
  tier: Tier;
  ownerId: string;
  sessionId?: string;
  /** monotonic recency key; assigned by the store on write. */
  seq?: number;
  /** the human-readable content (the markdown body for durable tiers). */
  text: string;
  /** structured payload — `FactPayload` for facts, free-form for other tiers. */
  payload?: FactPayload | unknown;
  /** top-level fact key (mirrors payload.key) so the index can enforce one-active-fact-per-(owner,key)
   *  structurally, without digging into JSON. Set only for the `fact` tier. */
  factKey?: string;

  // provenance / lineage
  sourceRunId?: string;
  /** the originating ActionEvent id (distinct from the run id) — coding-companion provenance. */
  sourceEventId?: string;
  lineageIds?: string[];
  repoId?: string;
  /** absolute repo path (project identity often needs path + remote, not just an id). */
  repoPath?: string;

  // lifecycle
  createdAt: string; // ISO-8601
  updatedAt?: string;
  /** tombstone for real ("forget") deletion — distinct from supersede. */
  deletedAt?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  /** supersede-not-overwrite: a newer active entry hides this one (facts). */
  superseded?: boolean;

  // scoring / consolidation
  importance?: number; // 1-10, stamped at write
  confidence?: number; // 0-1, for consolidated facts
  ttlPolicy?: string; // forgetting category

  // index provenance (so a re-embed/engine swap is a reindex, not a migration)
  embedModel?: string;
  embedDim?: number;
  embeddingStatus?: 'pending' | 'indexed' | 'failed';

  // integrity / privacy
  contentHash?: string;
  encryptionVersion?: number;
}
