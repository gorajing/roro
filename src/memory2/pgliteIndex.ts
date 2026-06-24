// src/memory2/pgliteIndex.ts — the PGlite + pgvector (HNSW) implementation of IndexStore.
//
// Chosen by benchmark (docs/MEMORY-ARCHITECTURE.md): HNSW keeps KNN ~1.5ms flat to 100k+ (vs sqlite-vec's
// linear brute force). This is a DERIVED cache: it stores the full Entry as a jsonb `doc` (so retrieval
// returns the exact entry) plus the columns it filters/orders/reconciles on. Rebuildable from files via
// reindexFrom (atomic: embed-all-first, then delete+insert in one txn, so a failure never empties it).

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Entry } from './types';
import type { IndexStore, VectorMatch } from './indexStore';

const toVec = (e?: number[]): string | null => (e ? `[${e.join(',')}]` : null);

export async function createPgliteIndex(opts: { dataDir?: string; dim?: number; embedModel?: string }): Promise<IndexStore> {
  const dim = opts.dim ?? 768;
  const db = await PGlite.create(opts.dataDir ?? 'memory://', { extensions: { vector } });
  await db.exec(`
    create extension if not exists vector;
    create table if not exists idx (
      id            text primary key,
      owner_id      text not null,
      tier          text not null,
      seq           bigint not null,
      fact_key      text,
      superseded    boolean not null default false,
      deleted_at    text,
      created_at    text not null,
      content_hash  text,
      schema_version int,
      embed_model   text,
      embed_dim     int,
      embedding     vector(${dim}),
      doc           jsonb not null
    );
    create table if not exists idx_meta (key text primary key, value text not null);
    create index if not exists idx_owner_seq on idx (owner_id, seq desc);
    create index if not exists idx_content_hash on idx (content_hash);
    create unique index if not exists idx_active_fact
      on idx (owner_id, fact_key)
      where tier = 'fact' and superseded = false and deleted_at is null;
    create index if not exists idx_hnsw on idx using hnsw (embedding vector_cosine_ops);
  `);

  // Guard against opening a persisted index whose vector column was built for a DIFFERENT dimension
  // (a changed embedder). create-if-not-exists keeps the old column, so verify + fail loud (the files
  // are the source of truth — move/rebuild the index dir to re-embed). pgvector stores dim in atttypmod.
  const dimRes = await db.query<{ atttypmod: number }>(
    `select a.atttypmod from pg_attribute a join pg_class c on a.attrelid = c.oid
     where c.relname = 'idx' and a.attname = 'embedding' and a.attnum > 0`,
  );
  const existingDim = dimRes.rows[0]?.atttypmod;
  if (typeof existingDim === 'number' && existingDim > 0 && existingDim !== dim) {
    await db.close();
    throw new Error(
      `memory2 index embedding dimension is vector(${existingDim}) but ${dim} was requested — ` +
        `vector spaces are not mixable; rebuild the index from files (reindex) after moving the index dir.`,
    );
  }
  // Guard on embed-MODEL identity too: the dim check above catches 768->1536, but two different models
  // of the SAME dimension (e.g. nomic-embed-text -> mxbai-embed-large, both 768) yield incompatible
  // vector spaces under an identical column type — silently corrupting recall. Persist the model in
  // idx_meta on first use; fail loud (the files are the source of truth — reindex after moving the dir).
  if (opts.embedModel) {
    const r = await db.query<{ value: string }>(`select value from idx_meta where key = 'embed_model'`);
    const existing = r.rows[0]?.value;
    if (existing && existing !== opts.embedModel) {
      await db.close();
      throw new Error(
        `memory2 index was built with embed model '${existing}' but '${opts.embedModel}' is configured — ` +
          `same-dimension vector spaces are not mixable; rebuild the index from files (reindex) after moving the index dir.`,
      );
    }
    if (!existing) {
      await db.query(
        `insert into idx_meta (key, value) values ('embed_model', $1) on conflict (key) do update set value = $1`,
        [opts.embedModel],
      );
    }
  }

  // (Encryption-MODE is a store property, guarded at the files-as-truth layer — see encryptionMode.ts.
  // The dim + embed_model guards above are INDEX properties, so they belong here in idx_meta.)
  // Larger candidate window so owner/tier/live FILTERS around the approximate HNSW scan don't under-return.
  await db.exec(`set hnsw.ef_search = 100;`).catch(() => { /* best-effort tuning hint; recall still works at the default ef_search */ });

  const UPSERT = `insert into idx
      (id, owner_id, tier, seq, fact_key, superseded, deleted_at, created_at,
       content_hash, schema_version, embed_model, embed_dim, embedding, doc)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector,$14::jsonb)
    on conflict (id) do update set
      owner_id = excluded.owner_id, tier = excluded.tier, seq = excluded.seq, fact_key = excluded.fact_key,
      superseded = excluded.superseded, deleted_at = excluded.deleted_at, created_at = excluded.created_at,
      content_hash = excluded.content_hash, schema_version = excluded.schema_version,
      embed_model = excluded.embed_model, embed_dim = excluded.embed_dim,
      embedding = excluded.embedding, doc = excluded.doc`;

  function upsertParams(entry: Entry, embedding?: number[]): unknown[] {
    return [
      entry.id, entry.ownerId, entry.tier, entry.seq ?? 0, entry.factKey ?? null,
      entry.superseded ?? false, entry.deletedAt ?? null, entry.createdAt,
      entry.contentHash ?? null, entry.schemaVersion ?? null, entry.embedModel ?? null, entry.embedDim ?? null,
      toVec(embedding), JSON.stringify(entry),
    ];
  }

  return {
    async upsert(entry: Entry, embedding?: number[]): Promise<void> {
      await db.query(UPSERT, upsertParams(entry, embedding));
    },

    async vectorSearch({ ownerId, embedding, k, tier }): Promise<VectorMatch[]> {
      const res = await db.query<{ doc: Entry; similarity: number }>(
        `select doc, 1 - (embedding <=> $1::vector) as similarity
         from idx
         where owner_id = $2 and superseded = false and deleted_at is null and embedding is not null
           and ($3::text is null or tier = $3)
         order by embedding <=> $1::vector
         limit $4`,
        [toVec(embedding), ownerId, tier ?? null, k],
      );
      return res.rows.map((r) => ({ entry: r.doc, similarity: Number(r.similarity) }));
    },

    async episodesToPrune({ ownerId, maxLive, maxAgeCutoff, keepNewest, batchSize }): Promise<Array<{ id: string; ownerId: string }>> {
      // Rank live episodes newest-first PER OWNER; prune those past keepNewest that are also past the
      // count cap OR older than the age cutoff. created_at is ISO text → lexical compare is chronological.
      const res = await db.query<{ id: string; owner_id: string }>(
        `with live as (
           select id, owner_id, created_at,
             row_number() over (partition by owner_id order by seq desc) as rn
           from idx
           where tier = 'episode' and superseded = false and deleted_at is null
             and ($1::text is null or owner_id = $1)
         )
         select id, owner_id from live
         where rn > $2 and (rn > $3 or created_at < $4)
         order by rn desc
         limit $5`,
        [ownerId ?? null, keepNewest, maxLive, maxAgeCutoff, batchSize],
      );
      return res.rows.map((r) => ({ id: r.id, ownerId: r.owner_id }));
    },

    async recent({ ownerId, k, tier }): Promise<Entry[]> {
      const res = await db.query<{ doc: Entry }>(
        `select doc from idx
         where owner_id = $1 and superseded = false and deleted_at is null
           and ($2::text is null or tier = $2)
         order by seq desc limit $3`,
        [ownerId, tier ?? null, k],
      );
      return res.rows.map((r) => r.doc);
    },

    async facts(ownerId: string): Promise<Entry[]> {
      const res = await db.query<{ doc: Entry }>(
        `select doc from idx
         where owner_id = $1 and tier = 'fact' and superseded = false and deleted_at is null
         order by seq desc`,
        [ownerId],
      );
      return res.rows.map((r) => r.doc);
    },

    async get(id: string): Promise<Entry | undefined> {
      const res = await db.query<{ doc: Entry }>(`select doc from idx where id = $1`, [id]);
      return res.rows[0]?.doc;
    },

    async remove(id: string): Promise<void> {
      await db.query(`delete from idx where id = $1`, [id]);
    },

    async count(): Promise<number> {
      const res = await db.query<{ n: number }>(`select count(*)::int as n from idx`);
      return res.rows[0]?.n ?? 0;
    },

    async maxSeq(): Promise<number> {
      const res = await db.query<{ n: number }>(`select coalesce(max(seq), 0)::int as n from idx`);
      return res.rows[0]?.n ?? 0;
    },

    async getAppliedSeq(): Promise<number> {
      const res = await db.query<{ value: string }>(`select value from idx_meta where key = 'applied_seq'`);
      return res.rows[0] ? Number(res.rows[0].value) : 0;
    },

    async setAppliedSeq(seq: number): Promise<void> {
      await db.query(
        `insert into idx_meta (key, value) values ('applied_seq', $1)
         on conflict (key) do update set value = $1`,
        [String(seq)],
      );
    },

    async reindexFrom(entries: Iterable<Entry>, embedFor: (entry: Entry) => Promise<{ embedding?: number[]; failed?: boolean }>): Promise<void> {
      // Embed EVERYTHING first; only then swap. If any embed throws, the existing index is untouched.
      // embedFor opens/decrypts + skips empties; a failed embed marks the row (no vector) the same way the
      // incremental indexEntry path does. The entry is stored as-is (sealed doc preserved).
      const staged: Array<{ entry: Entry; embedding?: number[] }> = [];
      for (const entry of entries) {
        const r = await embedFor(entry);
        staged.push({ entry: r.failed ? { ...entry, embeddingStatus: 'failed' } : entry, embedding: r.embedding });
      }
      await db.query('begin');
      try {
        await db.query('delete from idx');
        for (const { entry, embedding } of staged) await db.query(UPSERT, upsertParams(entry, embedding));
        await db.query('commit');
      } catch (err) {
        await db.query('rollback');
        throw err;
      }
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}
