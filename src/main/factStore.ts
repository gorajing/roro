// src/main/factStore.ts — write a thin profile fact with supersede-not-overwrite.
// Pure of the LLM (the caller passes a FactCandidate); trivially testable with fakes.
import type { MemoryRow, ReplaceFactInput, FactPayload } from '../shared/memory';
import type { FactCandidate } from '../brain/extractFact';

export interface FactStoreDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  /** Atomic supersede-all-for-key + insert (one transaction). The store enforces ≤1 active per key. */
  replaceFact(input: ReplaceFactInput): Promise<MemoryRow>;
}

function factKeyOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.key === 'string' ? p.key : undefined;
}

function factValueOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.value === 'string' ? p.value : undefined;
}

// Serialize fact writes. replaceFact() is atomic per call, but the no-op pre-check below reads
// getProfile first; the orchestrator void-dispatches extraction and does NOT serialize turns, so
// two concurrent extractions for the same key could interleave (read, read, write, write). The
// global write-chain makes them strictly sequential so the later writer cleanly supersedes the
// earlier. Memory is owned by ONE process for ONE local user, so a single chain is the simplest
// correct guard. (If multi-owner concurrency ever matters, key the lock by ownerId.)
let writeChain: Promise<void> = Promise.resolve();

/**
 * Store one extracted fact. null -> no write. Same key + same value -> no-op. Same key +
 * changed value -> replaceFact (atomic supersede-all-for-key + insert). Writes are serialized so
 * the supersede-not-overwrite invariant holds under concurrent turns.
 */
export function extractAndStoreFact(
  deps: FactStoreDeps,
  candidate: FactCandidate | null,
  ctx: { ownerId: string; sessionId: string; turnTs: number },
): Promise<void> {
  if (!candidate) return Promise.resolve();
  const run = writeChain.then(() => storeFact(deps, candidate, ctx));
  // Keep the chain alive even if this write rejects, so one failure can't wedge the queue.
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function storeFact(
  deps: FactStoreDeps,
  candidate: FactCandidate,
  ctx: { ownerId: string; sessionId: string; turnTs: number },
): Promise<void> {
  const activeForKey = (await deps.getProfile(ctx.ownerId)).filter((r) => factKeyOf(r) === candidate.key);
  // No-op only when the key already has EXACTLY one active row carrying this value (steady state).
  if (activeForKey.length === 1 && factValueOf(activeForKey[0]) === candidate.value) return;

  const payload: FactPayload = {
    key: candidate.key,
    value: candidate.value,
    source: { session_id: ctx.sessionId, turn_ts: ctx.turnTs },
  };
  // replaceFact supersedes EVERY prior active row for the key and inserts the replacement in ONE
  // transaction (embedding done first, outside the txn). All-or-nothing: an embed/DB failure leaves
  // the prior fact active (never zero active facts, never a transient duplicate).
  await deps.replaceFact({
    owner_id: ctx.ownerId,
    session_id: ctx.sessionId,
    text: candidate.value,
    key: candidate.key,
    payload,
  });
}
