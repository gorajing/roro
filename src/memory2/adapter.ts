// src/memory2/adapter.ts — the cutover bridge: memory2 behind the orchestrator's old MemoryModule contract.
//
// The orchestrator/factStore/siblings speak the shared/memory.ts shapes (owner_id/key, MemoryRow,
// MemoryMatch, the four-kind MemoryKind). memory2 speaks its own richer model (ownerId/factKey, Entry,
// the four-tier model). This adapter is the seam that lets us cut the live app over to memory2 WITHOUT
// touching every caller — a translation layer, not a reimplementation. Retiring src/memory becomes a
// one-line specifier change behind this contract.
//
// Mapping decisions:
//   kind <-> tier: the durable 'fact' tier is 1:1 with kind:'fact'; the three episodic kinds
//   (observation/narration/action) all map to the 'episode' tier (the turn log). On the way back an
//   episode reports kind:'observation' — the orchestrator's recall context does not branch on the
//   specific episodic kind, and facts are surfaced separately via getProfile.

import { createMemoryStore, type MemoryStore } from './memoryStore';
import { importanceFor } from './importance';
import { repoId } from './repoId';
import type { Cipher } from './cipher';
import type { Tracer } from './tracer';
import type { Entry, Tier } from './types';
import type {
  EpisodeKind,
  MemoryKind,
  RememberInput,
  ReplaceFactInput,
  MemoryRow,
  MemoryMatch,
  RecallInput,
  ProfileFactSourceView,
  ProfileFactView,
} from '../shared/memory';
import { factSource, fixFact, profileFacts, verifyFact } from './profileFacts';

const KIND_TO_TIER: Record<Exclude<MemoryKind, 'fact'>, Tier> = {
  observation: 'episode',
  narration: 'episode',
  action: 'episode',
};

const tierToKind = (t: Tier): MemoryKind => (t === 'fact' ? 'fact' : 'observation');

/** Mirror the old store's input contract (src/memory/index.ts) so the cutover preserves validation. */
function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}
function normalizeK(k = 5): number {
  if (!Number.isInteger(k) || k < 1) throw new Error(`recall k must be a positive integer, got ${k}`);
  return k;
}

/** Project a memory2 Entry into the orchestrator's MemoryRow contract (the read shape callers expect). */
function entryToRow(e: Entry): MemoryRow {
  return {
    id: e.id,
    owner_id: e.ownerId,
    session_id: e.sessionId ?? '',
    kind: tierToKind(e.tier),
    text: e.text,
    payload: e.payload ?? null,
    confidence: e.confidence,
    superseded: e.superseded ?? false,
    created_at: e.createdAt,
    embed_model: e.embedModel,
    embed_dim: e.embedDim,
  };
}

/** The old MemoryModule contract, served by a memory2 store. */
export interface Memory2Adapter {
  remember(input: RememberInput): Promise<MemoryRow>;
  replaceFact(input: ReplaceFactInput): Promise<MemoryRow>;
  reinforceFact(input: { owner_id: string; key: string }): Promise<MemoryRow | null>;
  recall(input: RecallInput): Promise<MemoryMatch[]>;
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  /** Renderer-safe active facts for the Memory panel. */
  profileFacts(ownerId: string): Promise<ProfileFactView[]>;
  /** Replace one active fact value by id. Owner/key are resolved from the active profile. */
  fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView>;
  /** Corroborate one active fact by id. Owner/key are resolved from the active profile. */
  verifyFact(ownerId: string, id: string): Promise<ProfileFactView>;
  /** Return safe local source metadata for one active fact. */
  factSource(ownerId: string, id: string): Promise<ProfileFactSourceView>;
  supersede(id: string): Promise<void>;
  /** HARD-delete one of the owner's active facts (the Forget panel — M8). Owner-scoped + active-only: a no-op
   *  if `id` isn't among this owner's current profile facts (so it can't delete an arbitrary or other-owner id). */
  forgetFact(ownerId: string, id: string): Promise<void>;
  close(): Promise<void>;
}

export interface Memory2AdapterOpts {
  dir: string;
  embed: (text: string) => Promise<number[]>;
  dim?: number;
  embedModel?: string;
  /** When present, content is encrypted at rest (passed straight through to the store). */
  cipher?: Cipher;
  /** One-way observation tap (passed straight through to the store). */
  tracer?: Tracer;
}

/** Wrap a memory2 MemoryStore in the orchestrator's old MemoryModule contract. */
export async function createMemory2Adapter(opts: Memory2AdapterOpts): Promise<Memory2Adapter> {
  const store: MemoryStore = await createMemoryStore(opts);
  const deps = {
    async getProfile(ownerId: string): Promise<MemoryRow[]> {
      return (await store.getProfile(ownerId)).map(entryToRow);
    },
    async replaceFact(input: ReplaceFactInput): Promise<MemoryRow> {
      const e = await store.replaceFact({
        ownerId: input.owner_id,
        factKey: input.key,
        sessionId: input.session_id,
        text: input.text,
        payload: input.payload,
      });
      return entryToRow(e);
    },
    async reinforceFact(input: { owner_id: string; key: string }): Promise<MemoryRow | null> {
      const e = await store.reinforceFact({ ownerId: input.owner_id, factKey: input.key });
      return e ? entryToRow(e) : null;
    },
  };
  return {
    async remember(input: RememberInput): Promise<MemoryRow> {
      // Facts are DERIVED (extractor + replaceFact's atomic supersede); a direct fact-remember would
      // bypass that discipline — reject it here exactly as memory2's remember() does.
      if (input.kind === 'fact') {
        throw new Error('memory2 adapter: remember() does not accept facts — use replaceFact (atomic supersede)');
      }
      requireText(input.owner_id, 'remember owner_id');
      requireText(input.text, 'remember text');
      const kind = input.kind as EpisodeKind; // narrowed: the fact guard above rejects the only other member
      const e = await store.remember({
        tier: KIND_TO_TIER[kind],
        ownerId: input.owner_id,
        sessionId: input.session_id,
        text: input.text,
        payload: input.payload,
        // Persist WHICH episodic channel wrote the row (W5): the kind survives storage instead of
        // collapsing to 'observation' on the way back.
        episodeKind: kind,
        // Deterministic importance by kind (M5): nudges the recall blend so the user's own words rank above
        // the cat's paraphrase. Derived here so EVERY remember() is stamped without each caller passing it.
        importance: importanceFor(kind),
        // Project scope (M5b): stamp the repo path + a stable derived id so recall can boost same-repo
        // memories. Absent repo_path → empty repoId → an unscoped (global) memory.
        repoPath: input.repo_path,
        repoId: repoId(input.repo_path ?? ''),
      });
      return entryToRow(e);
    },

    async replaceFact(input: ReplaceFactInput): Promise<MemoryRow> {
      return deps.replaceFact(input);
    },

    async reinforceFact(input: { owner_id: string; key: string }): Promise<MemoryRow | null> {
      return deps.reinforceFact(input);
    },

    async recall(input): Promise<MemoryMatch[]> {
      requireText(input.query, 'recall query');
      requireText(input.ownerId, 'recall ownerId');
      const k = normalizeK(input.k);
      const hits = await store.recall({ query: input.query, ownerId: input.ownerId, k, repoId: input.repoId });
      // similarity = RAW cosine (the old contract's meaning); recency-only rows have none -> 0. The hybrid
      // improvement lives in the result ORDER (blend-ranked). `guaranteed` carries the store's recency
      // promise through the contract so caller-side similarity floors exempt those rows BY TYPE (they
      // carry cosine 0 and a naive floor would drop exactly them).
      return hits.map((h) => ({ ...entryToRow(h.entry), similarity: h.cosine ?? 0, guaranteed: h.guaranteed }));
    },

    async getProfile(ownerId: string): Promise<MemoryRow[]> {
      return deps.getProfile(ownerId);
    },

    // The trust-loop helpers are Entry-based (W5): the store IS the deps (same signatures), no
    // row-translation layer in between. Their OUTPUT views stay the frozen renderer shapes.
    profileFacts(ownerId: string): Promise<ProfileFactView[]> {
      return profileFacts(store, ownerId);
    },

    fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView> {
      return fixFact(store, ownerId, id, value);
    },

    verifyFact(ownerId: string, id: string): Promise<ProfileFactView> {
      return verifyFact(store, ownerId, id);
    },

    factSource(ownerId: string, id: string): Promise<ProfileFactSourceView> {
      return factSource(store, ownerId, id);
    },

    supersede(id: string): Promise<void> {
      return store.supersede(id);
    },

    async forgetFact(ownerId: string, id: string): Promise<void> {
      // Verify the id is one of THIS owner's active facts before the hard delete — store.deleteEntry removes
      // by tier+id without an owner check, so this is the owner-scope + active-only guard (never delete an
      // id the owner doesn't actively have; getProfile is owner-scoped).
      const owned = (await store.getProfile(ownerId)).some((e) => e.id === id);
      if (!owned) return;
      await store.forget({ tier: 'fact', id, ownerId });
    },

    close(): Promise<void> {
      return store.close();
    },
  };
}
