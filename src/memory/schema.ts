// src/memory/schema.ts — the embedded-Postgres schema for the owner-scoped memory store.
// Applied programmatically at store construction (idempotent), NOT via a REST/RPC migration:
// PGlite is in-process, so there is no network boundary and no need for stored RPC functions —
// the adapter issues parameterized SQL directly (see ./index.ts).
//
// Provenance: every row stamps embed_model + embed_dim on write so a future re-embed-on-
// tier-change is auditable (which embedder wrote which vector). The design re-embeds on a
// tier change and NEVER mixes vector spaces.
export const SCHEMA_SQL = `
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
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

-- seq is a monotonic insertion counter: it gives "newest first" a deterministic total order
-- (now() collides when two facts are written in the same tick) and persists across reopen.
create index if not exists memory_owner_idx on memory (owner_id);
create index if not exists memory_owner_fact_idx
  on memory (owner_id, seq desc)
  where kind = 'fact' and superseded = false;
`;
