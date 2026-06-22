// src/shared/memory.ts — PGlite (embedded Postgres + pgvector) memory contract (owner-scoped).
export type MemoryKind = 'action' | 'narration' | 'observation' | 'fact';

export interface RememberInput {
  owner_id: string;
  session_id: string;
  kind: MemoryKind;
  text: string;
  payload?: unknown;
}

export interface MemoryRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  text: string;
  payload: unknown;
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
