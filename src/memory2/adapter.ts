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
import type { Cipher } from './cipher';
import type { Entry, Tier } from './types';
import type { MemoryKind, RememberInput, ReplaceFactInput, MemoryRow, MemoryMatch } from '../shared/memory';

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
  recall(input: { query: string; k?: number; ownerId: string; sessionId?: string }): Promise<MemoryMatch[]>;
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  supersede(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface Memory2AdapterOpts {
  dir: string;
  embed: (text: string) => Promise<number[]>;
  dim?: number;
  embedModel?: string;
  /** When present, content is encrypted at rest (passed straight through to the store). */
  cipher?: Cipher;
}

/** Wrap a memory2 MemoryStore in the orchestrator's old MemoryModule contract. */
export async function createMemory2Adapter(opts: Memory2AdapterOpts): Promise<Memory2Adapter> {
  const store: MemoryStore = await createMemoryStore(opts);
  return {
    async remember(input: RememberInput): Promise<MemoryRow> {
      // Facts are DERIVED (extractor + replaceFact's atomic supersede); a direct fact-remember would
      // bypass that discipline — reject it here exactly as memory2's remember() does.
      if (input.kind === 'fact') {
        throw new Error('memory2 adapter: remember() does not accept facts — use replaceFact (atomic supersede)');
      }
      requireText(input.owner_id, 'remember owner_id');
      requireText(input.text, 'remember text');
      const e = await store.remember({
        tier: KIND_TO_TIER[input.kind],
        ownerId: input.owner_id,
        sessionId: input.session_id,
        text: input.text,
        payload: input.payload,
      });
      return entryToRow(e);
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

    async recall(input): Promise<MemoryMatch[]> {
      requireText(input.query, 'recall query');
      requireText(input.ownerId, 'recall ownerId');
      const k = normalizeK(input.k);
      const hits = await store.recall({ query: input.query, ownerId: input.ownerId, k });
      // similarity = RAW cosine (the old contract's meaning); recency-only rows have none -> 0. The hybrid
      // improvement lives in the result ORDER (blend-ranked), not in this field. NOTE for the wiring step:
      // the caller's cosine floor (memoryContext.ts) must be reconciled with the recency guarantee — a
      // recency-only row carries cosine 0 and would be dropped by a >0.3 cosine filter.
      return hits.map((h) => ({ ...entryToRow(h.entry), similarity: h.cosine ?? 0 }));
    },

    async getProfile(ownerId: string): Promise<MemoryRow[]> {
      return (await store.getProfile(ownerId)).map(entryToRow);
    },

    supersede(id: string): Promise<void> {
      return store.supersede(id);
    },

    close(): Promise<void> {
      return store.close();
    },
  };
}
