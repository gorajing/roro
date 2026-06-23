// src/memory/schema.ts — the embedded-Postgres schema for the owner-scoped memory store.
// Applied programmatically at store construction (idempotent), NOT via a REST/RPC migration:
// PGlite is in-process, so there is no network boundary and no need for stored RPC functions —
// the adapter issues parameterized SQL directly (see ./index.ts).
//
// Provenance: every row stamps embed_model + embed_dim on write so a future re-embed-on-
// tier-change is auditable (which embedder wrote which vector). The design re-embeds on a
// tier change and NEVER mixes vector spaces — so the embedding column's dimension is fixed at
// store creation to the active embedder's dimension (768 local nomic, 1536 Nebius Qwen).

/** Build the schema with the embedding column sized to the active embedder's dimension. */
export function buildSchemaSql(embedDim: number): string {
  return `
create extension if not exists vector;

create table if not exists memory (
  id          uuid primary key default gen_random_uuid(),
  seq         bigserial,
  owner_id    text not null,
  session_id  text not null,
  kind        text not null,
  text        text not null,
  payload     jsonb,
  superseded  boolean not null default false,
  embed_model text,
  embed_dim   int,
  embedding   vector(${embedDim}),
  created_at  timestamptz not null default now()
);

-- seq is a monotonic insertion counter: it gives "newest first" a deterministic total order
-- (now() collides when two facts are written in the same tick) and persists across reopen.
create index if not exists memory_owner_idx on memory (owner_id);
create index if not exists memory_owner_fact_idx
  on memory (owner_id, seq desc)
  where kind = 'fact' and superseded = false;

-- Heal any pre-existing duplicate ACTIVE facts (residue of the old non-atomic insert-before-
-- supersede path) BEFORE building the unique index below, so applying this schema to a legacy store
-- can never fail the index build (which would brick startup). Supersede every active fact that has a
-- NEWER active sibling for the same (owner_id, key), keeping only the newest (max seq). On a clean
-- store this updates zero rows. NULL-key facts are unaffected (NULL = NULL is not true).
update memory m set superseded = true
where m.kind = 'fact' and m.superseded = false
  and exists (
    select 1 from memory n
    where n.kind = 'fact' and n.superseded = false
      and n.owner_id = m.owner_id
      and n.payload->>'key' = m.payload->>'key'
      and n.seq > m.seq
  );

-- The supersede-not-overwrite invariant made STRUCTURAL: at most ONE active fact per (owner, key).
-- replaceFact() supersedes the prior active row in the SAME transaction as the insert, so a real
-- correction never trips this; what it forbids is a duplicate active fact slipping in by any path
-- (a buggy writer, a crash mid-replace). Facts without a 'key' (NULL) are exempt — NULLs are
-- distinct in a unique index — but factStore always writes a key.
create unique index if not exists memory_active_fact_key_uidx
  on memory (owner_id, (payload->>'key'))
  where kind = 'fact' and superseded = false;
`;
}

/** The default 768-dim schema (local nomic-embed-text). Importers that don't vary the dimension. */
export const SCHEMA_SQL = buildSchemaSql(768);
