// src/shared/memory.ts — the CANONICAL memory contract (owner-scoped, unified on Entry/tier in W5).
//
// One durable memory = one Entry. Files are the source of truth (src/memory2); the index is a
// derived, in-memory cache rebuilt from the manifest every launch. This module is the single home
// for the shapes that cross process/module seams: the Entry model, the episode kinds, and the
// renderer-facing fact views (FROZEN byte-for-byte — snake_case — because the Memory panel and its
// packaged smokes pin them).

// ---------------------------------------------------------------------------
// The canonical model
// ---------------------------------------------------------------------------

/** The four physical tiers (keep v1 minimal; "working set" is a query, "graph" is reserved). */
export type Tier = 'core' | 'fact' | 'episode' | 'trace';

/** What kind of EPISODE a row is (episode tier only; facts are a TIER, not a kind). Persisted as
 *  Entry.episodeKind so the blend's importance nudge survives storage. */
export type EpisodeKind = 'observation' | 'narration' | 'action';

/** Provenance for a thin profile fact. snake_case: FROZEN renderer-facing shape. */
export interface FactSource {
  session_id: string;
  turn_ts: number;
  /** Executor-facts pilot provenance (absent = the 3B extraction / manual path). */
  channel?: 'executor';
  /** Which executor's model claimed the fact (e.g. 'codex') — shown in the panel's Source detail. */
  claimed_by?: string;
  /** The ≤140-char verbatim quote the user saw when confirming. Bounded by admission; stored so the
   *  Source detail can honestly answer "why does roro think this?". */
  evidence?: string;
}

/** The structured payload stored on a fact-tier Entry (typed so the single-active-fact invariant can
 *  be structural). `source` is optional on the type — the write paths always stamp it, but stored
 *  history may predate it and the views degrade gracefully. */
export interface FactPayload {
  key: string;
  value: string;
  source?: FactSource;
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
  /** which episodic channel wrote this row (episode tier only) — drives the importance nudge. */
  episodeKind?: EpisodeKind;

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

// ---------------------------------------------------------------------------
// Renderer-facing views — FROZEN byte-for-byte (snake_case; the Memory panel + packaged smokes pin
// these shapes and the IPC channel names)
// ---------------------------------------------------------------------------

/** Renderer-safe active profile fact view. */
export interface ProfileFactView {
  id: string;
  key: string;
  value: string;
  text: string;
  confidence?: number;
  created_at: string;
  source?: FactSource;
}

/** Renderer-safe provenance response for one active profile fact. */
export interface ProfileFactSourceView {
  id: string;
  source?: FactSource;
}

// ---------------------------------------------------------------------------
// LEGACY shapes (the old MemoryModule contract) — consumers flip to the Entry contract in the W5
// unification; these die with adapter.ts. Do not add new uses.
// ---------------------------------------------------------------------------

export type MemoryKind = 'action' | 'narration' | 'observation' | 'fact';

export interface RememberInput {
  owner_id: string;
  session_id: string;
  kind: MemoryKind;
  text: string;
  payload?: unknown;
  /** Absolute path of the repo this memory belongs to (M5). A stable repoId is derived from it for
   *  project-scoped recall; absent (answer/clarify or no-workdir turns) → an unscoped global memory. */
  repo_path?: string;
}

/**
 * Input to the atomic fact-replace primitive. `replaceFact` supersedes every prior ACTIVE fact for
 * (owner_id, key) and inserts this one in a SINGLE transaction — so the "≤1 active fact per key"
 * invariant never sees a transient duplicate. kind is always 'fact'; it is not a parameter.
 */
export interface ReplaceFactInput {
  owner_id: string;
  session_id: string;
  /** The new fact's text (its value). */
  text: string;
  /** The fact key whose prior active rows are superseded before this insert. */
  key: string;
  payload?: unknown;
}

/**
 * Episodic recall query (owner-scoped). `repoId` (M5b) boosts same-project memories — optional, so an
 * unscoped recall is unchanged. Shared by the recall deps / adapter / module / facade so this field set can
 * never drift across copies (the bug that left the facade unaware of repoId until it was unified here).
 */
export interface RecallInput {
  query: string;
  k?: number;
  ownerId: string;
  sessionId?: string;
  repoId?: string;
}

export interface MemoryRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  text: string;
  payload: unknown;
  confidence?: number;
  superseded: boolean;
  // Embedding provenance — stamped on write; OPTIONAL because the recall/getProfile reads
  // keep their projection minimal and do not return it.
  embed_model?: string;
  embed_dim?: number;
  created_at: string;
}

export interface MemoryMatch extends MemoryRow {
  /** RAW cosine for vector-channel rows; recency-guaranteed rows carry 0 (they were never scored). */
  similarity: number;
  /** memory2's recency guarantee: the store PROMISES this row surfaces regardless of cosine. Callers
   *  must exempt guaranteed rows from any similarity floor — dropping one silently kills temporal
   *  recall ("what did we just do?"). Typed here so the invariant can't be lost in a refactor. */
  guaranteed: boolean;
}

/**
 * Guard for the renderer-facing remember bridge. Facts are DERIVED internally (the brain extractor
 * + factStore's serialized supersede-not-overwrite path) — a direct renderer write of kind:'fact'
 * would bypass that discipline and could create duplicate active facts for a key.
 */
export function assertRendererMemoryKind(kind: MemoryKind): void {
  if (kind === 'fact') {
    throw new Error("memory.remember from the renderer cannot write kind:'fact' (facts are derived internally)");
  }
}
