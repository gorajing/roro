// src/main/factStore.ts — write a thin profile fact with supersede-not-overwrite.
// Pure of the LLM (the caller passes a FactCandidate); trivially testable with fakes.
import type { MemoryRow, RememberInput, FactPayload } from '../shared/memory';
import type { FactCandidate } from '../brain/extractFact';

export interface FactStoreDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  remember(input: RememberInput): Promise<MemoryRow>;
  supersede(id: string): Promise<void>;
}

function factKeyOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.key === 'string' ? p.key : undefined;
}

function factValueOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.value === 'string' ? p.value : undefined;
}

// Serialize fact writes. The read/supersede/insert below is a non-atomic sequence; the
// orchestrator void-dispatches extraction and does NOT serialize turns, so two concurrent
// extractions for the same key could each read "no existing row" and both insert, leaving two
// active facts (a stale value resurfacing — the exact thing supersede-not-overwrite prevents).
// Memory is owned by ONE process for ONE local user, so a single global write-chain is the
// simplest correct guard. (If multi-owner concurrency ever matters, key the lock by ownerId.)
let writeChain: Promise<void> = Promise.resolve();

/**
 * Store one extracted fact. null -> no write. Same key + same value -> no-op. Same key +
 * changed value -> mark the prior row superseded, then insert the new one (append-only history).
 * Writes are serialized so the supersede-not-overwrite invariant holds under concurrent turns.
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
  // Insert the replacement BEFORE superseding the old rows. remember() embeds (a network call that
  // can fail); doing it first means a failure leaves the prior fact active (stale-but-present) —
  // never zero active facts (silent loss of a taught preference).
  await deps.remember({
    owner_id: ctx.ownerId,
    session_id: ctx.sessionId,
    kind: 'fact',
    text: candidate.value,
    payload,
  });
  // Supersede EVERY prior active row for the key — this also heals a duplicate that a past
  // supersede-after-insert failure may have left behind, so it can never permanently resurface.
  for (const row of activeForKey) await deps.supersede(row.id);
}
