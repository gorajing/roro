// src/main/factStore.ts — write a thin profile fact with supersede-not-overwrite.
// Pure of the LLM (the caller passes a FactCandidate); trivially testable with fakes.
import type { Entry, FactSource, FactPayload } from '../../shared/memory';
import type { FactCandidate } from '../brain/extractFact';

export interface FactStoreDeps {
  getProfile(ownerId: string): Promise<Entry[]>;
  /** Atomic supersede-all-for-key + insert. The store enforces ≤1 active per key. */
  replaceFact(input: { ownerId: string; factKey: string; text: string; payload?: unknown; sessionId?: string }): Promise<Entry>;
  /** Corroborate the active fact for (ownerId, factKey): strengthen its confidence in place (consolidation). */
  reinforceFact(input: { ownerId: string; factKey: string }): Promise<Entry | null>;
}

function factKeyOf(entry: Entry): string | undefined {
  const p = entry.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.key === 'string' ? p.key : entry.factKey;
}

function factValueOf(entry: Entry): string | undefined {
  const p = entry.payload as Partial<FactPayload> | null;
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
/** What the write did, for the extraction trace: 'noop' (null candidate), 'reinforced' (same value
 *  corroborated in place), or 'stored' (new fact / value change superseded + inserted). */
export type FactWriteOutcome = 'stored' | 'reinforced' | 'noop';

export interface FactWriteCtx {
  ownerId: string;
  sessionId: string;
  turnTs: number;
  /** Executor-facts pilot: extra provenance folded into payload.source (absent = 3B/manual path). */
  provenance?: Pick<FactSource, 'channel' | 'claimed_by' | 'evidence'>;
}

export function extractAndStoreFact(
  deps: FactStoreDeps,
  candidate: FactCandidate | null,
  ctx: FactWriteCtx,
): Promise<FactWriteOutcome> {
  if (!candidate) return Promise.resolve('noop');
  const run = writeChain.then(() => storeFact(deps, candidate, ctx));
  // Keep the chain alive even if this write rejects, so one failure can't wedge the queue.
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function storeFact(
  deps: FactStoreDeps,
  candidate: FactCandidate,
  ctx: FactWriteCtx,
): Promise<FactWriteOutcome> {
  const activeForKey = (await deps.getProfile(ctx.ownerId)).filter((e) => factKeyOf(e) === candidate.key);
  // Corroboration: the key already has EXACTLY one active row carrying this value (steady state). Don't
  // churn the fact (no supersede + insert of a new row) — instead REINFORCE it: re-confirmation
  // strengthens confidence in place (the consolidation "gets-smarter" loop). It still re-puts the same
  // id durably (a soft-signal update), but never creates a superseded duplicate.
  if (activeForKey.length === 1 && factValueOf(activeForKey[0]) === candidate.value) {
    await deps.reinforceFact({ ownerId: ctx.ownerId, factKey: candidate.key });
    return 'reinforced';
  }

  // The STORED payload shape is unchanged by the W5 unification: source stays snake_case (it is the
  // frozen provenance shape the Memory panel's Source detail reads back).
  const payload: FactPayload = {
    key: candidate.key,
    value: candidate.value,
    source: { session_id: ctx.sessionId, turn_ts: ctx.turnTs, ...(ctx.provenance ?? {}) },
  };
  // replaceFact supersedes EVERY prior active row for the key and inserts the replacement atomically
  // (embedding done first, outside any write). All-or-nothing: an embed/store failure leaves the
  // prior fact active (never zero active facts, never a transient duplicate).
  await deps.replaceFact({
    ownerId: ctx.ownerId,
    sessionId: ctx.sessionId,
    text: candidate.value,
    factKey: candidate.key,
    payload,
  });
  return 'stored';
}
