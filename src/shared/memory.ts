// src/shared/memory.ts — PGlite (embedded Postgres + pgvector) memory contract (owner-scoped).
export type MemoryKind = 'action' | 'narration' | 'observation' | 'fact';

export interface RememberInput {
  owner_id: string;
  session_id: string;
  kind: MemoryKind;
  text: string;
  payload?: unknown;
  /** Absolute path of the repo this memory belongs to (M5). The adapter derives a stable repoId from it for
   *  project-scoped recall; absent (answer/clarify or no-workdir turns) → an unscoped global memory. */
  repo_path?: string;
}

/**
 * Input to the atomic fact-replace primitive. `replaceFact` supersedes every prior ACTIVE fact for
 * (owner_id, key) and inserts this one in a SINGLE transaction — so the "≤1 active fact per key"
 * invariant (enforced by a partial-unique index) never sees a transient duplicate. kind is always
 * 'fact'; it is not a parameter.
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
  similarity: number;
}

/** Provenance for a thin profile fact. */
export interface FactSource {
  session_id: string;
  turn_ts: number;
}

/** The structured payload stored on a `kind:'fact'` row. */
export interface FactPayload {
  key: string;
  value: string;
  source: FactSource;
}

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
