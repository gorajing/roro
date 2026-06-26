import type {
  FactPayload,
  FactSource,
  MemoryRow,
  ProfileFactSourceView,
  ProfileFactView,
  ReplaceFactInput,
} from '../shared/memory';

export interface ProfileFactDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  replaceFact(input: ReplaceFactInput): Promise<MemoryRow>;
  reinforceFact(input: { owner_id: string; key: string }): Promise<MemoryRow | null>;
}

export class FactUnavailableError extends Error {
  constructor() {
    super('Fact is no longer available. Reopen Memory and try again.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function factPayloadOf(row: MemoryRow): Partial<FactPayload> {
  return isRecord(row.payload) ? row.payload : {};
}

function sourceOf(row: MemoryRow): FactSource | undefined {
  const source = factPayloadOf(row).source;
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
  return { session_id: sessionId, turn_ts: turnTs };
}

function fallbackSource(row: MemoryRow): FactSource {
  const turnTs = Date.parse(row.created_at);
  return {
    session_id: row.session_id || 'manual-correction',
    turn_ts: Number.isFinite(turnTs) ? turnTs : 0,
  };
}

function factKeyOf(row: MemoryRow): string | undefined {
  const key = factPayloadOf(row).key;
  return typeof key === 'string' && key.trim().length > 0 ? key : undefined;
}

function factValueOf(row: MemoryRow): string | undefined {
  const value = factPayloadOf(row).value;
  return typeof value === 'string' ? value : undefined;
}

function requireFactKey(row: MemoryRow): string {
  const key = factKeyOf(row);
  if (!key) throw new Error('Fact cannot be changed because its key is missing.');
  return key;
}

async function activeFactById(deps: ProfileFactDeps, ownerId: string, id: string): Promise<MemoryRow> {
  const rows = await deps.getProfile(ownerId);
  const row = rows.find((candidate) => candidate.id === id && candidate.owner_id === ownerId);
  if (!row) throw new FactUnavailableError();
  return row;
}

export function toProfileFactView(row: MemoryRow): ProfileFactView {
  return {
    id: row.id,
    key: factKeyOf(row) ?? '',
    value: factValueOf(row) ?? row.text,
    text: row.text,
    confidence: row.confidence,
    created_at: row.created_at,
    source: sourceOf(row),
  };
}

export async function profileFacts(deps: ProfileFactDeps, ownerId: string): Promise<ProfileFactView[]> {
  return (await deps.getProfile(ownerId))
    .filter((row) => row.kind === 'fact' && row.owner_id === ownerId)
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
  const row = await deps.replaceFact({
    owner_id: ownerId,
    session_id: current.session_id || source.session_id,
    key,
    text: nextValue,
    payload: { key, value: nextValue, source },
  });
  return toProfileFactView(row);
}

export async function verifyFact(
  deps: ProfileFactDeps,
  ownerId: string,
  id: string,
): Promise<ProfileFactView> {
  const current = await activeFactById(deps, ownerId, id);
  const row = await deps.reinforceFact({ owner_id: ownerId, key: requireFactKey(current) });
  if (!row) throw new FactUnavailableError();
  return toProfileFactView(row);
}

export async function factSource(
  deps: ProfileFactDeps,
  ownerId: string,
  id: string,
): Promise<ProfileFactSourceView> {
  const current = await activeFactById(deps, ownerId, id);
  return { id: current.id, source: sourceOf(current) };
}
