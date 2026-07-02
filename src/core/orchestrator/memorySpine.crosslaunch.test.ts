import { describe, it, expect } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import { buildRecallContext, type RecallDeps } from './memoryContext';
import type { Entry, MemoryMatch, FactPayload } from '../../shared/memory';

const factKeyOf = (e: Entry): string | undefined => (e.payload as FactPayload | null)?.key;

// One in-memory store implementing the SAME owner-scoped, superseded-aware contract the live store must.
function makeStore() {
  const entries: Entry[] = [];
  let n = 0;
  // Atomic supersede-all-for-key + insert — the same contract the real memory2 replaceFact upholds.
  const replaceFact: FactStoreDeps['replaceFact'] = async (input) => {
    for (const e of entries) {
      if (e.ownerId === input.ownerId && e.tier === 'fact' && factKeyOf(e) === input.factKey && !e.superseded) e.superseded = true;
    }
    const entry: Entry = { id: `id-${n++}`, schemaVersion: 1, tier: 'fact', ownerId: input.ownerId, sessionId: input.sessionId, factKey: input.factKey, text: input.text, payload: input.payload ?? null, superseded: false, createdAt: new Date(n).toISOString() };
    entries.push(entry);
    return entry;
  };
  const reinforceFact: FactStoreDeps['reinforceFact'] = async (input) =>
    entries.find((e) => e.ownerId === input.ownerId && e.tier === 'fact' && factKeyOf(e) === input.factKey && !e.superseded) ?? null;
  const getProfile = async (ownerId: string): Promise<Entry[]> =>
    entries.filter((e) => e.ownerId === ownerId && e.tier === 'fact' && !e.superseded);
  // recall: naive substring match scoped to owner (stands in for the cosine channel + owner filter).
  const recall = async ({ query, ownerId }: { query: string; ownerId: string; k?: number; sessionId?: string }): Promise<MemoryMatch[]> =>
    entries
      .filter((e) => e.ownerId === ownerId && e.tier !== 'fact' && query.split(' ').some((w) => e.text.includes(w)))
      .map((entry) => ({ entry, similarity: 0.9, guaranteed: false }));
  return { entries, deps: { getProfile, replaceFact, reinforceFact, recall } as FactStoreDeps & RecallDeps };
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

    // The taught fact carries provenance (the FROZEN snake_case source shape).
    const fact = store.entries.find((e) => e.tier === 'fact')!;
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
