import { describe, it, expect } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import { buildRecallContext, type RecallDeps } from './memoryContext';
import type { MemoryRow, MemoryMatch, ReplaceFactInput, FactPayload } from '../shared/memory';

const factKeyOf = (r: MemoryRow): string | undefined => (r.payload as FactPayload | null)?.key;

// One in-memory store implementing the SAME owner-scoped, superseded-aware contract the live SQL must.
function makeStore() {
  const rows: MemoryRow[] = [];
  let n = 0;
  // Atomic supersede-all-for-key + insert — the same contract the real PGlite replaceFact upholds.
  const replaceFact = async (input: ReplaceFactInput): Promise<MemoryRow> => {
    for (const r of rows) {
      if (r.owner_id === input.owner_id && r.kind === 'fact' && factKeyOf(r) === input.key && !r.superseded) r.superseded = true;
    }
    const row: MemoryRow = { id: `id-${n++}`, owner_id: input.owner_id, session_id: input.session_id, kind: 'fact', text: input.text, payload: input.payload ?? null, superseded: false, created_at: new Date(n).toISOString() };
    rows.push(row);
    return row;
  };
  const getProfile = async (ownerId: string) => rows.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded);
  // recall: naive substring match scoped to owner (stands in for pgvector cosine + owner filter).
  const recall = async ({ query, ownerId }: { query: string; ownerId: string; k?: number; sessionId?: string }): Promise<MemoryMatch[]> =>
    rows.filter((r) => r.owner_id === ownerId && r.kind !== 'fact' && query.split(' ').some((w) => r.text.includes(w))).map((r) => ({ ...r, similarity: 0.9 }));
  return { rows, deps: { getProfile, replaceFact, recall } as FactStoreDeps & RecallDeps };
}

const OWNER = 'owner-A';

describe('MEMORY SPINE — cross-launch teach→recall (the magic moment, headless)', () => {
  it('a fact taught in launch A is recalled in launch B (fresh session, same owner)', async () => {
    const store = makeStore();

    // --- Launch A: a turn teaches one durable fact ---
    await extractAndStoreFact(store.deps, { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });

    // --- Launch B: brand-new session id, SAME owner, app restarted ---
    const out = await buildRecallContext(store.deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('KNOWN ABOUT THIS USER:');
    expect(out.context).toContain('writes a test alongside each feature');

    // The taught fact carries provenance.
    const fact = store.rows.find((r) => r.kind === 'fact')!;
    expect((fact.payload as FactPayload).source).toEqual({ session_id: 'launch-A', turn_ts: 1 });
  });

  it('a later correction supersedes the old fact (no stale value resurfaces)', async () => {
    const store = makeStore();
    await extractAndStoreFact(store.deps, { key: 'pkg_manager', value: 'uses npm' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    await extractAndStoreFact(store.deps, { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: OWNER, sessionId: 'launch-B', turnTs: 2 });

    const out = await buildRecallContext(store.deps, { ownerId: OWNER, sessionId: 'launch-C', query: 'install deps', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('uses pnpm');
    expect(out.context).not.toContain('uses npm');
  });

  it('another owner on the same machine sees none of it', async () => {
    const store = makeStore();
    await extractAndStoreFact(store.deps, { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    const out = await buildRecallContext(store.deps, { ownerId: 'owner-B', sessionId: 'x', query: 'add a logout route' });
    expect(out.factCount).toBe(0);
    expect(out.context).toBeUndefined();
  });
});
