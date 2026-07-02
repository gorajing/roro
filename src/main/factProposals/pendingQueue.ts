// src/main/factProposals/pendingQueue.ts — MAIN-process in-memory queue of unconfirmed proposals.
//
// Deliberately NOT a 'proposed' state inside memory2: that would touch the ≤1-active-fact-per-key
// invariant, recall filtering, files-as-truth reconcile, and forgetting — invariant-hostile for a
// flag-gated pilot. Because unconfirmed proposals live ONLY here, recall/decide can never see one.
// The queue evaporates on quit by construction; a lost proposal is a harmless missed fact (the
// cost-asymmetry doctrine), and durability is an explicit v2 decision gated on the pilot's
// confirm-rate (docs/plans/executor-facts-pilot.md).

import type { PendingProposal } from './types';

const DEFAULT_CAP = 6;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingQueue {
  /** Append proposals (minting ids); evicts the oldest beyond the cap. Returns the queued rows. */
  add(items: Omit<PendingProposal, 'id' | 'createdAt'>[]): PendingProposal[];
  /** Live (non-expired) proposals, oldest first. Expiry is lazy — evaluated on read. */
  list(): PendingProposal[];
  /** Remove-and-return one proposal by id; null when unknown/expired/already taken (typed no-op). */
  take(id: string): PendingProposal | null;
  clear(): void;
}

export function createPendingQueue(opts: { cap?: number; ttlMs?: number; now?: () => number } = {}): PendingQueue {
  const cap = opts.cap ?? DEFAULT_CAP;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  let seq = 0;
  let items: PendingProposal[] = [];

  const expire = (): void => {
    const cutoff = now() - ttlMs;
    items = items.filter((p) => p.createdAt > cutoff);
  };

  return {
    add(newItems) {
      expire();
      const queued = newItems.map((item) => ({ ...item, id: `prop_${++seq}`, createdAt: now() }));
      items = [...items, ...queued].slice(-cap); // oldest evicted beyond the cap
      return queued;
    },
    list() {
      expire();
      return [...items];
    },
    take(id) {
      expire();
      const found = items.find((p) => p.id === id) ?? null;
      if (found) items = items.filter((p) => p.id !== id);
      return found;
    },
    clear() {
      items = [];
    },
  };
}
