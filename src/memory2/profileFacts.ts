// src/memory2/profileFacts.ts — the Memory-panel trust loop (see / fix / verify / source) over Entry.
//
// Entry-based since the W5 contract unification: the deps mirror MemoryStore's own signatures, so the
// facade passes the store STRAIGHT through (no row-translation layer). The OUTPUT views stay FROZEN
// byte-for-byte (snake_case ProfileFactView/ProfileFactSourceView/FactSource — the renderer contract).

import type {
  Entry,
  FactPayload,
  FactSource,
  ProfileFactSourceView,
  ProfileFactView,
} from '../shared/memory';

export interface ProfileFactDeps {
  /** Active profile facts for an owner (owner-scoped, superseded/deleted excluded). */
  getProfile(ownerId: string): Promise<Entry[]>;
  /** Atomic supersede-all-for-key + insert. The store enforces ≤1 active per key. */
  replaceFact(input: { ownerId: string; factKey: string; text: string; payload?: unknown; sessionId?: string }): Promise<Entry>;
  /** Corroborate the active fact for (ownerId, factKey): strengthen its confidence in place. */
  reinforceFact(input: { ownerId: string; factKey: string }): Promise<Entry | null>;
}

export class FactUnavailableError extends Error {
  constructor() {
    super('Fact is no longer available. Reopen Memory and try again.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function factPayloadOf(entry: Entry): Partial<FactPayload> {
  return isRecord(entry.payload) ? (entry.payload as Partial<FactPayload>) : {};
}

function sourceOf(entry: Entry): FactSource | undefined {
  const source: unknown = factPayloadOf(entry).source;
  if (!isRecord(source)) return undefined;
  const sessionId = typeof source.session_id === 'string'
    ? source.session_id
    : typeof source.sessionId === 'string'
      ? source.sessionId
      : undefined;
  const turnTs = typeof source.turn_ts === 'number'
    ? source.turn_ts
    : typeof source.turnTs === 'number'
      ? source.turnTs
      : undefined;
  if (!sessionId || typeof turnTs !== 'number') return undefined;
  const out: FactSource = { session_id: sessionId, turn_ts: turnTs };
  // Executor-proposal provenance (optional, additive): pass it THROUGH — the Source detail must be
  // able to name WHO claimed a fact, and fixFact rebuilds payload.source from this view, so
  // stripping here would both misattribute the fact and permanently erase provenance on a user fix.
  if (source.channel === 'executor') out.channel = 'executor';
  if (typeof source.claimed_by === 'string') out.claimed_by = source.claimed_by;
  if (typeof source.evidence === 'string') out.evidence = source.evidence;
  return out;
}

function fallbackSource(entry: Entry): FactSource {
  const turnTs = Date.parse(entry.createdAt);
  return {
    session_id: entry.sessionId || 'manual-correction',
    turn_ts: Number.isFinite(turnTs) ? turnTs : 0,
  };
}

function factKeyOf(entry: Entry): string | undefined {
  const key = factPayloadOf(entry).key ?? entry.factKey; // payload first (display truth), structural mirror second
  return typeof key === 'string' && key.trim().length > 0 ? key : undefined;
}

function factValueOf(entry: Entry): string | undefined {
  const value = factPayloadOf(entry).value;
  return typeof value === 'string' ? value : undefined;
}

function requireFactKey(entry: Entry): string {
  const key = factKeyOf(entry);
  if (!key) throw new Error('Fact cannot be changed because its key is missing.');
  return key;
}

async function activeFactById(deps: ProfileFactDeps, ownerId: string, id: string): Promise<Entry> {
  const entries = await deps.getProfile(ownerId);
  const entry = entries.find((candidate) => candidate.id === id && candidate.ownerId === ownerId);
  if (!entry) throw new FactUnavailableError();
  return entry;
}

export function toProfileFactView(entry: Entry): ProfileFactView {
  return {
    id: entry.id,
    key: factKeyOf(entry) ?? '',
    value: factValueOf(entry) ?? entry.text,
    text: entry.text,
    confidence: entry.confidence,
    created_at: entry.createdAt,
    source: sourceOf(entry),
  };
}

export async function profileFacts(deps: ProfileFactDeps, ownerId: string): Promise<ProfileFactView[]> {
  return (await deps.getProfile(ownerId))
    .filter((entry) => entry.tier === 'fact' && entry.ownerId === ownerId)
    .map(toProfileFactView);
}

export async function fixFact(
  deps: ProfileFactDeps,
  ownerId: string,
  id: string,
  value: string,
): Promise<ProfileFactView> {
  const nextValue = value.trim();
  if (nextValue.length === 0) throw new Error('Fact value must be non-empty.');

  const current = await activeFactById(deps, ownerId, id);
  const key = requireFactKey(current);
  const source = sourceOf(current) ?? fallbackSource(current);
  const entry = await deps.replaceFact({
    ownerId,
    sessionId: current.sessionId || source.session_id,
    factKey: key,
    text: nextValue,
    payload: { key, value: nextValue, source },
  });
  return toProfileFactView(entry);
}

export async function verifyFact(
  deps: ProfileFactDeps,
  ownerId: string,
  id: string,
): Promise<ProfileFactView> {
  const current = await activeFactById(deps, ownerId, id);
  const entry = await deps.reinforceFact({ ownerId, factKey: requireFactKey(current) });
  if (!entry) throw new FactUnavailableError();
  return toProfileFactView(entry);
}

export async function factSource(
  deps: ProfileFactDeps,
  ownerId: string,
  id: string,
): Promise<ProfileFactSourceView> {
  const current = await activeFactById(deps, ownerId, id);
  return { id: current.id, source: sourceOf(current) };
}
