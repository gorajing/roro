// src/memory2/memoryStore.ts — the unified memory2 API (files-as-truth + derived index + embedder).
//
// Composes the durable write coordinator (store.ts), the PGlite-HNSW index (pgliteIndex.ts), and an
// injected embedder. Every write is SERIALIZED through one chain so the derived index is updated in
// manifest (seq) order. remember() commits durably (file+manifest) FIRST, then embeds + indexes, then
// advances a persistent reconciliation cursor (applied_seq). recall()/recent()/getProfile() read the
// derived index. On open we RECONCILE: replay manifest ops with seq > applied_seq, in order, advancing
// the cursor per op — a CONTIGUOUS cursor that survives deletes (a regressing max(seq) would skip or
// replay ops). A failed embed degrades gracefully (the row is indexed without a vector, marked failed),
// so one bad op never blocks the cursor or loses a memory.
//
// (Hybrid retrieval and the atomic replaceFact/supersede land in the next increments; facts must go
// through replaceFact — remember() rejects them so a duplicate active fact can't be durably written
// before the index's unique constraint would reject it.)

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createMemoryWriter, type NewEntry } from './store';
import { createPgliteIndex } from './pgliteIndex';
import { readManifest } from './manifest';
import { readEpisodes } from './episodeLog';
import { readEntryFile, writeEntryFile, entryPath } from './entryFile';
import { blendCandidates, DEFAULT_WEIGHTS, type BlendWeights, type ScoredEntry } from './memoryScore';
import { openEntry, type Cipher } from './cipher';
import { effectiveConfidence } from './forgetting';
import { NOOP_TRACER, type Tracer, type TraceEvent } from './tracer';
import type { Entry } from './types';
import type { IndexStore } from './indexStore';

const SCHEMA_VERSION = 1;

// Consolidation (Zuhn-style confidence, facts-only): a single observation carries a moderate base
// confidence; each corroboration (the same fact re-confirmed) nudges it toward certainty, capped at 1.
// Accrual is INLINE at the fact write path — the deterministic core of "memory gets smarter"; the
// brain-driven episode→fact distillation + time-decay are later increments.
const BASE_CONFIDENCE = 0.5;
const CONFIDENCE_INCREMENT = 0.1;
const MAX_CONFIDENCE = 1;

// Forgetting (corpus bounding — the 3× accuracy lever): episodes are tombstoned beyond a per-owner cap
// or age. Facts/core are NEVER pruned (durable identity). Generous defaults so a fresh/small corpus
// prunes nothing; runs in a bounded batch on store-open. (Archive/summarization + JSONL compaction are
// deferred; fact "forgetting" is the lazy confidence decay in forgetting.ts, not deletion.)
const MS_PER_DAY = 86_400_000;
const PRUNE_MAX_LIVE = 5000;
const PRUNE_MAX_AGE_DAYS = 90;
const PRUNE_KEEP_NEWEST = 200;
const PRUNE_BATCH = 500;

export type RememberInput = Omit<NewEntry, 'id' | 'schemaVersion' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export interface MemoryStore {
  /** Durably store a memory (episode/core/trace), then embed + index it. Facts go via replaceFact. */
  remember(input: RememberInput): Promise<Entry>;
  /** Episodic HYBRID recall: blends cosine relevance + recency + importance (excludes facts), owner-scoped.
   *  The recency channel ensures temporal/meta queries ("what did we just do?") surface recent work even
   *  when cosine misses — the bug a real turn exposed. Returns ranked entries with explainable parts. */
  recall(opts: { query: string; ownerId: string; k?: number; weights?: BlendWeights }): Promise<ScoredEntry[]>;
  /** Most-recent episodes for an owner (the temporal/"what did we just do" path). */
  recent(opts: { ownerId: string; k?: number }): Promise<Entry[]>;
  /** Active profile facts for an owner ("KNOWN ABOUT THIS USER"), ordered by EFFECTIVE (time-decayed)
   *  confidence — most-corroborated + freshest first. `now` (ms) is injectable for deterministic tests. */
  getProfile(ownerId: string, now?: number): Promise<Entry[]>;
  /** Forgetting: tombstone old/excess EPISODES for an owner (or all owners) to bound the recall corpus.
   *  Facts/core are never pruned. Returns the number tombstoned. */
  pruneEpisodes(opts?: { ownerId?: string; maxLive?: number; maxAgeDays?: number; keepNewest?: number; batchSize?: number; now?: number }): Promise<number>;
  /** Set/replace the durable fact for (ownerId, factKey): supersede the prior active one, insert the new
   *  (exactly one active fact per key). Embed-first so a failed embed leaves the prior fact untouched. */
  replaceFact(input: { ownerId: string; factKey: string; text: string; payload?: unknown; sessionId?: string }): Promise<Entry>;
  /** Corroborate the active fact for (ownerId, factKey): raise its confidence + access stats IN PLACE
   *  (no supersede/churn). Returns the updated fact, or null if no active fact exists for the key. */
  reinforceFact(input: { ownerId: string; factKey: string }): Promise<Entry | null>;
  /** Mark an entry superseded (hidden from getProfile/recall) — supersede-not-overwrite. */
  supersede(id: string): Promise<void>;
  close(): Promise<void>;
}

/** Index a (possibly-sealed) entry: embed from PLAINTEXT but store the SEALED doc. Degrades gracefully
 *  if the embedder is down (row stays usable, no vector). */
async function indexEntry(
  index: IndexStore,
  entry: Entry,
  embed: (t: string) => Promise<number[]>,
  cipher?: Cipher,
): Promise<void> {
  const plain = cipher ? openEntry(entry, cipher) : entry; // decrypt for embedding only
  let embedding: number[] | undefined;
  if (plain.text.trim()) {
    try {
      embedding = await embed(plain.text);
    } catch (err) {
      console.warn(`[memory2] embed failed for ${entry.tier}/${entry.id} — indexed without a vector: ${(err as Error).message}`);
      entry = { ...entry, embeddingStatus: 'failed' };
    }
  }
  await index.upsert(entry, embedding); // the SEALED entry is the stored doc
}

/**
 * Replay manifest ops the index hasn't applied yet (files > manifest > DB), in seq order, advancing a
 * CONTIGUOUS persistent cursor per op. Survives deletes (cursor is not derived from row max) and never
 * skips a durable write whose prior index update failed.
 */
async function reconcile(dir: string, index: IndexStore, embed: (t: string) => Promise<number[]>, cipher?: Cipher): Promise<void> {
  const applied = await index.getAppliedSeq();
  const ops = (await readManifest(dir)).filter((o) => o.seq > applied).sort((a, b) => a.seq - b.seq);
  if (ops.length === 0) return;

  const logById = new Map<string, Entry>();
  for (const tier of ['episode', 'trace'] as const) {
    for (const e of await readEpisodes(dir, tier)) logById.set(e.id, e);
  }

  for (const op of ops) {
    if (op.op === 'delete') {
      await index.remove(op.id);
    } else if (op.op === 'replace_fact') {
      // Redo the compound op idempotently from the WAL payload: supersede priors (files + index) BEFORE
      // inserting the fresh fact (the unique index forbids two active), then materialize + index fresh.
      for (const pid of op.supersedeIds ?? []) {
        let prior: Entry | undefined;
        try { prior = await readEntryFile(entryPath(dir, { tier: 'fact', id: pid } as Entry)); } catch { prior = undefined; }
        if (prior) {
          const sup = prior.superseded ? prior : { ...prior, superseded: true };
          if (!prior.superseded) await writeEntryFile(dir, sup);
          await index.upsert(sup);
        }
      }
      if (op.entry) {
        try { await readEntryFile(entryPath(dir, op.entry)); } catch { await writeEntryFile(dir, op.entry); }
        await indexEntry(index, op.entry, embed, cipher); // op.entry is sealed at rest; indexEntry opens to embed
      }
    } else {
      let entry: Entry | undefined;
      if (op.tier === 'episode' || op.tier === 'trace') {
        entry = logById.get(op.id);
      } else {
        try { entry = await readEntryFile(entryPath(dir, { tier: op.tier, id: op.id } as Entry)); } catch { entry = undefined; }
      }
      if (entry) await indexEntry(index, entry, embed, cipher);
      else console.warn(`[memory2] reconcile: no file for ${op.tier}/${op.id} (seq ${op.seq}) — files win, skipped`);
    }
    await index.setAppliedSeq(op.seq); // advance the contiguous cursor (processed, even if skipped/deleted)
  }
}

export async function createMemoryStore(opts: {
  dir: string;
  embed: (text: string) => Promise<number[]>;
  dim?: number;
  embedModel?: string;
  /** When present, content (text + payload) is encrypted at rest; reads decrypt transparently. */
  cipher?: Cipher;
  /** One-way observation tap (RORO_TRACE eval substrate). Defaults to a no-op (zero overhead). */
  tracer?: Tracer;
}): Promise<MemoryStore> {
  const { dir, embed, dim, embedModel, cipher, tracer = NOOP_TRACER } = opts;
  // Decrypt an entry read back from the (sealed) index/files; no-op when encryption is off.
  const open = (e: Entry): Entry => (cipher ? openEntry(e, cipher) : e);
  // Tracing is STRICTLY ONE-WAY: a tracer (even a buggy injected one) must never break a memory op, so
  // every emit is swallowed here. `tracing` gates the expensive payload construction when the tap is off.
  const tracing = tracer !== NOOP_TRACER;
  const safeEmit = (event: TraceEvent): void => {
    try { tracer.emit(event); } catch { /* one-way: a trace failure never disturbs the operation */ }
  };
  // Ensure the data root exists before PGlite opens its (non-recursive) index subdir — the file-write
  // helpers create their own tier dirs, but the index dir's parent must exist first.
  await mkdir(dir, { recursive: true });
  const writer = createMemoryWriter({ dir, cipher });
  const index = await createPgliteIndex({ dataDir: join(dir, 'index'), dim, embedModel });
  await reconcile(dir, index, embed, cipher);

  // Serialize the whole write path so the index is updated + the cursor advanced in seq order.
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const r = tail.then(fn, fn);
    tail = r.then(() => undefined, () => undefined);
    return r;
  }

  const api: MemoryStore = {
    remember(input: RememberInput): Promise<Entry> {
      if (input.tier === 'fact') {
        return Promise.reject(new Error('memory2: remember() does not accept facts — use replaceFact (atomic supersede)'));
      }
      return serialize(async () => {
        const base: NewEntry = {
          ...input,
          id: input.id ?? randomUUID(),
          schemaVersion: SCHEMA_VERSION,
          createdAt: input.createdAt ?? new Date().toISOString(),
          embedModel: input.embedModel ?? embedModel,
          embedDim: input.embedDim ?? dim,
        };
        const entry = await writer.putEntry(base); // durable (file + manifest), SEALED, assigns seq + contentHash
        await indexEntry(index, entry, embed, cipher);
        await index.setAppliedSeq(entry.seq ?? 0);
        safeEmit({ kind: 'remember', ownerId: entry.ownerId, id: entry.id, tier: entry.tier });
        return open(entry); // plaintext for the caller
      });
    },

    async recall({ query, ownerId, k = 5, weights }): Promise<ScoredEntry[]> {
      // Cosine channel — but a query-time embed outage must NOT suppress recent memories, so degrade to
      // recency-only on failure (the docs' "never return zero when recent rows exist").
      let vec: Awaited<ReturnType<IndexStore['vectorSearch']>> = [];
      try {
        const embedding = await embed(query);
        vec = await index.vectorSearch({ ownerId, embedding, k: Math.max(k * 4, 20), tier: 'episode' });
      } catch (err) {
        console.warn(`[memory2] recall embed failed — recency-only this turn: ${(err as Error).message}`);
      }
      const rec = await index.recent({ ownerId, k: Math.max(k * 2, 10), tier: 'episode' });
      const candidates = [
        ...vec.map((m) => ({ entry: m.entry, cosine: m.similarity })),
        ...rec.map((entry) => ({ entry })), // recency-only candidates (no cosine)
      ];
      const blended = blendCandidates(candidates, weights ?? DEFAULT_WEIGHTS);

      // Guarantee the most-recent episodes survive competition (the RECENT-ACTIONS channel): temporal
      // queries ("what did we just do?") must surface recent work even amid many strong cosine matches.
      const scoredById = new Map(blended.map((b) => [b.entry.id, b]));
      const guaranteed = rec
        .slice(0, Math.min(2, k))
        .map((e) => scoredById.get(e.id))
        .filter((b): b is ScoredEntry => Boolean(b));
      const gIds = new Set(guaranteed.map((g) => g.entry.id));
      // Blend on the SEALED entries (structural fields only), then decrypt the survivors for the caller.
      const result = [...guaranteed, ...blended.filter((b) => !gIds.has(b.entry.id))]
        .slice(0, k)
        .map((s) => ({ ...s, entry: open(s.entry) }));
      // Observation tap: log the FULL candidate pool's score COMPONENTS + which were returned (no result
      // text) — the eval substrate to replay alternate weights + diagnose near-misses. Built only when on.
      if (tracing) {
        const returnedIds = new Set(result.map((s) => s.entry.id));
        safeEmit({
          kind: 'recall', ownerId, query, k,
          candidates: blended.map((b) => ({ id: b.entry.id, score: b.score, cosine: b.cosine, parts: b.parts, returned: returnedIds.has(b.entry.id) })),
        });
      }
      return result;
    },

    async recent({ ownerId, k = 5 }): Promise<Entry[]> {
      return (await index.recent({ ownerId, k, tier: 'episode' })).map(open);
    },

    async getProfile(ownerId: string, now: number = Date.now()): Promise<Entry[]> {
      // Surface the strongest facts first by EFFECTIVE confidence (stored evidence × time-decay): the
      // "knows-you" layer leads with what we're most sure of AND most recently confirmed. Stored
      // confidence is untouched (decay is read-time). index.facts is a small set, so the sort is cheap.
      return (await index.facts(ownerId))
        .map(open)
        .sort((a, b) => effectiveConfidence(b, now) - effectiveConfidence(a, now) || (b.seq ?? 0) - (a.seq ?? 0));
    },

    pruneEpisodes(opts = {}): Promise<number> {
      const {
        ownerId, maxLive = PRUNE_MAX_LIVE, maxAgeDays = PRUNE_MAX_AGE_DAYS,
        keepNewest = PRUNE_KEEP_NEWEST, batchSize = PRUNE_BATCH, now = Date.now(),
      } = opts;
      return serialize(async () => {
        const maxAgeCutoff = new Date(now - maxAgeDays * MS_PER_DAY).toISOString();
        const victims = await index.episodesToPrune({ ownerId, maxLive, maxAgeCutoff, keepNewest, batchSize });
        let lastSeq = 0;
        for (const v of victims) {
          lastSeq = await writer.deleteEntry({ tier: 'episode', id: v.id, ownerId: v.ownerId }); // durable tombstone op
          await index.remove(v.id);
        }
        if (lastSeq > 0) await index.setAppliedSeq(lastSeq); // advance the cursor past the delete ops
        if (victims.length > 0) {
          console.warn(`[memory2] pruned ${victims.length} old/excess episode(s) (corpus bound)`);
          safeEmit({ kind: 'prune', ownerId, count: victims.length, ids: victims.map((v) => v.id) });
        }
        return victims.length;
      });
    },

    reinforceFact({ ownerId, factKey }): Promise<Entry | null> {
      if (!ownerId?.trim() || !factKey?.trim()) {
        return Promise.reject(new Error('memory2: reinforceFact requires non-empty ownerId and factKey'));
      }
      return serialize(async () => {
        const active = (await index.facts(ownerId)).find((f) => f.factKey === factKey);
        if (!active) return null; // nothing to corroborate (caller should replaceFact for a new fact)
        const opened = open(active);
        const { seq: _s, contentHash: _c, ...rest } = opened;
        const now = new Date().toISOString();
        // Re-put the SAME id in place (no supersede): only the soft signals change. putEntry re-fingerprints
        // + reseals under the new seq's AAD; confidence/lastAccessedAt/accessCount are not bound in the AAD.
        const bumped = await writer.putEntry({
          ...rest,
          confidence: Math.min(MAX_CONFIDENCE, (opened.confidence ?? BASE_CONFIDENCE) + CONFIDENCE_INCREMENT),
          lastAccessedAt: now,
          accessCount: (opened.accessCount ?? 0) + 1,
          updatedAt: now,
        });
        await indexEntry(index, bumped, embed, cipher);
        await index.setAppliedSeq(bumped.seq ?? 0);
        safeEmit({ kind: 'fact', op: 'reinforce', ownerId, factKey, id: bumped.id, confidence: bumped.confidence });
        return open(bumped);
      });
    },

    replaceFact(input): Promise<Entry> {
      if (!input.ownerId?.trim() || !input.factKey?.trim() || !input.text?.trim()) {
        return Promise.reject(new Error('memory2: replaceFact requires non-empty ownerId, factKey, and text'));
      }
      return serialize(async () => {
        // Embed FIRST: a failed embed must leave the prior active fact untouched (no partial write).
        const embedding = await embed(input.text);
        // Supersede ALL prior active facts for this key (defensive vs duplicates), via the atomic WAL op:
        // commitReplaceFact appends the compound op (fresh content + prior ids) BEFORE materializing, so a
        // crash is redoable by reconcile — the "never zero active facts" guarantee holds.
        const priors = (await index.facts(input.ownerId)).filter((f) => f.factKey === input.factKey);
        const fresh: NewEntry = {
          id: randomUUID(), schemaVersion: SCHEMA_VERSION, tier: 'fact', ownerId: input.ownerId,
          factKey: input.factKey, text: input.text, payload: input.payload, sessionId: input.sessionId,
          createdAt: new Date().toISOString(), embedModel, embedDim: dim, confidence: BASE_CONFIDENCE,
        };
        const { fresh: committed, superseded } = await writer.commitReplaceFact(fresh, priors.map((p) => p.id));
        for (const sup of superseded) await index.upsert(sup); // priors first (unique-index safe), SEALED
        await index.upsert(committed, embedding); // SEALED doc + plaintext embedding
        await index.setAppliedSeq(committed.seq ?? 0);
        safeEmit({ kind: 'fact', op: 'replace', ownerId: input.ownerId, factKey: input.factKey, id: committed.id, confidence: BASE_CONFIDENCE, supersededIds: priors.map((p) => p.id) });
        return open(committed); // plaintext for the caller
      });
    },

    supersede(id: string): Promise<void> {
      if (!id?.trim()) return Promise.reject(new Error('memory2: supersede requires a non-empty id'));
      return serialize(async () => {
        const stored = await index.get(id);
        if (!stored) return;
        // Open before re-put: putEntry re-fingerprints over plaintext + re-seals with the new seq's AAD.
        const { seq: _s, contentHash: _c, ...rest } = open(stored);
        const sup = await writer.putEntry({ ...rest, superseded: true, updatedAt: new Date().toISOString() });
        await index.upsert(sup);
        await index.setAppliedSeq(sup.seq ?? 0);
        safeEmit({ kind: 'supersede', ownerId: sup.ownerId, id });
      });
    },

    async close(): Promise<void> {
      await index.close();
    },
  };

  // Self-maintaining corpus bound: prune old/excess episodes once on open (a bounded batch, all owners).
  // Awaited so it can't race teardown; a no-op on a fresh/small corpus (the generous defaults match none).
  await api.pruneEpisodes({});
  return api;
}
