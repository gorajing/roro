// src/memory/index.ts — the owner-scoped memory store on LOCAL PGlite (embedded Postgres) +
// pgvector. Re-authored from the original Insforge REST/RPC adapter: PGlite runs in-process, so
// reads/writes are direct parameterized SQL (no `fetch`, no stored RPC functions).
//
// SINGLE-WRITER: PGlite is single-connection. The store is owned by the MAIN process only; the
// renderer reaches it through IPC. Never open two live instances on one dataDir concurrently.
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { MemoryMatch, MemoryRow, RememberInput, ReplaceFactInput } from '../shared/memory';
import { SCHEMA_SQL } from './schema';

const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';
const NEBIUS_EMBEDDING_MODEL = process.env.NEBIUS_EMBED_MODEL || 'Qwen/Qwen3-Embedding-8B';
const EMBEDDING_DIMENSION = 1536;

declare const process: { env: Record<string, string | undefined>; cwd(): string };

/** Produces a length-1536 embedding for a piece of text. Injected so the store is testable. */
export type Embedder = (text: string) => Promise<number[]> | number[];

export interface RecallInput {
  query: string;
  k?: number;
  ownerId: string;
  sessionId?: string;
}

export interface MemoryStore {
  remember(input: RememberInput): Promise<MemoryRow>;
  replaceFact(input: ReplaceFactInput): Promise<MemoryRow>;
  recall(input: RecallInput): Promise<MemoryMatch[]>;
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  supersede(id: string): Promise<void>;
  close(): Promise<void>;
}

// ---- The store factory (PGlite + pgvector) ----

const SELECT_COLS =
  'id, owner_id, session_id, kind, text, payload, superseded, created_at';

// Shared INSERT for remember()/replaceFact(): same columns, same provenance stamp. Bind the vector
// as a text literal ($8::vector) — a raw JS array does not bind to the pgvector type.
const INSERT_SQL = `insert into memory
     (owner_id, session_id, kind, text, payload, embed_model, embed_dim, embedding)
   values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::vector)
   returning ${SELECT_COLS}, embed_model, embed_dim`;

function insertParams(
  fields: { owner_id: string; session_id: string; kind: string; text: string; payload?: unknown },
  embedding: number[],
): unknown[] {
  return [
    fields.owner_id,
    fields.session_id,
    fields.kind,
    fields.text,
    JSON.stringify(fields.payload ?? null),
    // Provenance stamp: which embedder wrote this vector. Makes a future re-embed auditable.
    NEBIUS_EMBEDDING_MODEL,
    EMBEDDING_DIMENSION,
    toVectorLiteral(embedding),
  ];
}

/**
 * Open (or create) an owner-scoped memory store backed by PGlite + pgvector.
 * `dataDir` persists to the filesystem (survives close/reopen — the cross-launch spine);
 * omit it (or pass 'memory://') for an ephemeral in-memory store (tests).
 */
export async function createMemoryStore(opts: {
  dataDir?: string;
  embed: Embedder;
}): Promise<MemoryStore> {
  const db = await PGlite.create(opts.dataDir ?? 'memory://', {
    extensions: { vector },
  });
  await db.exec(SCHEMA_SQL);

  const embedOne = async (text: string): Promise<number[]> =>
    assertEmbedding(await opts.embed(text));

  async function remember(input: RememberInput): Promise<MemoryRow> {
    requireText(input.text, 'remember text');
    requireText(input.owner_id, 'remember owner_id');
    const embedding = await embedOne(input.text);
    const res = await db.query<RawRow>(INSERT_SQL, insertParams(input, embedding));
    return toRow(res.rows[0]);
  }

  /**
   * Atomic supersede-not-overwrite for a profile fact. Embed FIRST (a network call that can fail,
   * and PGlite is single-connection — never hold a txn open across a network round-trip): on embed
   * failure nothing is mutated, so the prior fact stays active (never zero active facts). Then, in
   * ONE transaction, supersede every prior active row for (owner_id, key) and insert the new one —
   * the partial-unique index therefore never observes two active rows for the key.
   */
  async function replaceFact(input: ReplaceFactInput): Promise<MemoryRow> {
    requireText(input.text, 'replaceFact text');
    requireText(input.owner_id, 'replaceFact owner_id');
    requireText(input.key, 'replaceFact key');
    const embedding = await embedOne(input.text);
    return db.transaction(async (tx) => {
      await tx.query(
        `update memory set superseded = true
         where owner_id = $1 and kind = 'fact'
           and payload->>'key' = $2 and superseded = false`,
        [input.owner_id, input.key],
      );
      const res = await tx.query<RawRow>(
        INSERT_SQL,
        insertParams({ ...input, kind: 'fact' }, embedding),
      );
      return toRow(res.rows[0]);
    });
  }

  /**
   * Owner-scoped episodic recall by cosine similarity. EXCLUDES facts (they surface through
   * getProfile under their own label) and superseded rows. `sessionId` is accepted for API
   * compatibility but intentionally NOT used as a filter — recall is owner-primary so prior
   * launches' episodes are recallable in a new session (the cross-launch requirement).
   */
  async function recall(input: RecallInput): Promise<MemoryMatch[]> {
    requireText(input.query, 'recall query');
    requireText(input.ownerId, 'recall ownerId');
    const k = normalizeK(input.k);
    const queryEmbedding = await embedOne(input.query);
    const res = await db.query<RawRow & { similarity: number }>(
      `select ${SELECT_COLS}, 1 - (embedding <=> $1::vector) as similarity
       from memory
       where owner_id = $2
         and kind <> 'fact'
         and coalesce(superseded, false) = false
         and embedding is not null
       order by embedding <=> $1::vector
       limit $3`,
      [toVectorLiteral(queryEmbedding), input.ownerId, k],
    );
    return res.rows.map(toMatch);
  }

  /** Active (non-superseded) profile facts for an owner, newest first. */
  async function getProfile(ownerId: string): Promise<MemoryRow[]> {
    requireText(ownerId, 'getProfile ownerId');
    const res = await db.query<RawRow>(
      `select ${SELECT_COLS}
       from memory
       where owner_id = $1
         and kind = 'fact'
         and coalesce(superseded, false) = false
       order by seq desc`,
      [ownerId],
    );
    return res.rows.map(toRow);
  }

  /** Mark a row superseded (supersede-not-overwrite; also the future "forget" primitive). */
  async function supersede(id: string): Promise<void> {
    requireText(id, 'supersede id');
    await db.query(`update memory set superseded = true where id = $1`, [id]);
  }

  async function close(): Promise<void> {
    await db.close();
  }

  return { remember, replaceFact, recall, getProfile, supersede, close };
}

// ---- Module-level default store (the production singleton) ----
//
// The orchestrator / ipc call these module-level functions. They delegate to one lazily-created
// PGlite store on the resolved dataDir, using the brain/Nebius embedder. Tests use the factory
// above with a fake embedder + an in-memory store instead.

let defaultStorePromise: Promise<MemoryStore> | null = null;

function resolveDataDir(): string {
  return process.env.COMPANION_DB_DIR || join(process.cwd(), '.roro-memory');
}

function getDefaultStore(): Promise<MemoryStore> {
  if (!defaultStorePromise) {
    defaultStorePromise = createMemoryStore({ dataDir: resolveDataDir(), embed: embedText });
  }
  return defaultStorePromise;
}

export async function remember(input: RememberInput): Promise<MemoryRow> {
  return (await getDefaultStore()).remember(input);
}

export async function replaceFact(input: ReplaceFactInput): Promise<MemoryRow> {
  return (await getDefaultStore()).replaceFact(input);
}

export async function recall(input: RecallInput): Promise<MemoryMatch[]> {
  return (await getDefaultStore()).recall(input);
}

export async function getProfile(ownerId: string): Promise<MemoryRow[]> {
  return (await getDefaultStore()).getProfile(ownerId);
}

export async function supersede(id: string): Promise<void> {
  return (await getDefaultStore()).supersede(id);
}

// ---- Row mapping (PGlite returns timestamptz as a JS Date, jsonb as a parsed object) ----

interface RawRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  text: string;
  payload: unknown;
  superseded: boolean;
  created_at: Date | string;
  embed_model?: string | null;
  embed_dim?: number | null;
}

function toRow(r: RawRow): MemoryRow {
  return {
    id: r.id,
    owner_id: r.owner_id,
    session_id: r.session_id,
    kind: r.kind,
    text: r.text,
    payload: r.payload ?? null,
    superseded: r.superseded,
    embed_model: r.embed_model ?? undefined,
    embed_dim: r.embed_dim ?? undefined,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

function toMatch(r: RawRow & { similarity: number }): MemoryMatch {
  return { ...toRow(r), similarity: Number(r.similarity) };
}

/** pgvector text literal: '[0.1,0.2,...]'. A raw JS array does not bind to the vector type. */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ---- The default embedder: the brain's local embed(), else Nebius over HTTP ----

type BrainEmbed = (text: string) => Promise<number[]> | number[];
type BrainModule = { embed?: unknown; default?: { embed?: unknown } };
type NebiusEmbeddingResponse = { data?: Array<{ embedding?: unknown }> };

let checkedBrainEmbed = false;
let brainEmbed: BrainEmbed | null = null;

/** Default embedder for the production store. */
async function embedText(text: string): Promise<number[]> {
  const localEmbed = await loadBrainEmbed();
  return localEmbed ? assertEmbedding(await localEmbed(text)) : embedWithNebius(text);
}

async function loadBrainEmbed(): Promise<BrainEmbed | null> {
  if (checkedBrainEmbed) {
    return brainEmbed;
  }
  // brain is a COMMITTED sibling module — a failure to import it is a real bug, not an expected
  // "not built yet" condition. Let it propagate (fail loud) rather than silently using Nebius and
  // masking a broken brain. Memoize only on SUCCESS, so a transient import failure isn't cached as a
  // permanent "no local embedder" verdict. If the module loads but exposes no embed(), fall back to
  // Nebius HTTP (a deliberate null, not a swallowed error).
  const brain = (await import('../brain')) as BrainModule;
  const candidate =
    typeof brain.embed === 'function' ? brain.embed : brain.default?.embed;
  brainEmbed = typeof candidate === 'function' ? (candidate as BrainEmbed) : null;
  checkedBrainEmbed = true;
  return brainEmbed;
}

async function embedWithNebius(text: string): Promise<number[]> {
  const response = await fetch(`${NEBIUS_BASE_URL}embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('NEBIUS_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NEBIUS_EMBEDDING_MODEL,
      input: text,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSION,
    }),
  });
  if (!response.ok) {
    throw new Error(`Nebius embedding failed ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as NebiusEmbeddingResponse;
  return assertEmbedding(payload.data?.[0]?.embedding);
}

function assertEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Embedding provider returned a non-array embedding');
  }
  if (value.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Embedding dimension ${value.length} does not match vector(${EMBEDDING_DIMENSION})`);
  }
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('Embedding provider returned a non-numeric embedding value');
  }
  return value;
}

function normalizeK(k = 5): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`recall k must be a positive integer, got ${k}`);
  }
  return k;
}

function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
