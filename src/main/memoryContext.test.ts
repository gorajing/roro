import { describe, it, expect } from 'vitest';
import { composeMemoryContext, buildRecallContext, type RecallDeps } from './memoryContext';
import type { Entry, MemoryMatch } from '../shared/memory';

const OWNER = 'owner-A';
function factEntry(text: string, over: Partial<Entry> = {}): Entry {
  return { id: 'f', schemaVersion: 1, tier: 'fact', ownerId: OWNER, sessionId: 's', factKey: 'k', text, payload: {}, superseded: false, createdAt: '2026-06-21T00:00:00Z', ...over };
}
function match(text: string, similarity: number, guaranteed = false): MemoryMatch {
  return { entry: factEntry(text, { tier: 'episode', factKey: undefined, episodeKind: 'observation' }), similarity, guaranteed };
}

describe('composeMemoryContext', () => {
  it('labels facts separately from episodes', () => {
    const ctx = composeMemoryContext([factEntry('writes a test alongside each feature')], [match('user asked to add a login route', 0.7)]);
    expect(ctx).toContain('KNOWN ABOUT THIS USER:');
    expect(ctx).toContain('- writes a test alongside each feature');
    expect(ctx).toContain('RELATED PAST CONTEXT:');
    expect(ctx).toContain('- user asked to add a login route');
    // facts segment must come before episodes so truncation never drops them first
    expect(ctx!.indexOf('KNOWN ABOUT THIS USER')).toBeLessThan(ctx!.indexOf('RELATED PAST CONTEXT'));
  });
  it('returns undefined when there is nothing to say', () => {
    expect(composeMemoryContext([], [])).toBeUndefined();
  });
  it('emits only the facts section when there are no episodes', () => {
    const ctx = composeMemoryContext([factEntry('prefers Zustand')], []);
    expect(ctx).toContain('KNOWN ABOUT THIS USER:');
    expect(ctx).not.toContain('RELATED PAST CONTEXT:');
  });
});

describe('buildRecallContext (cross-launch: facts survive a session change)', () => {
  // An in-memory fake honoring owner-scoping + the similarity floor — the contract the live store implements.
  function fakeDeps(store: { profile: Entry[]; matches: MemoryMatch[] }): RecallDeps {
    return {
      getProfile: async (ownerId) => store.profile.filter((e) => e.ownerId === ownerId && e.tier === 'fact' && !e.superseded),
      recall: async ({ ownerId }) => store.matches.filter((m) => m.entry.ownerId === ownerId),
    };
  }

  it('surfaces a prior-session fact in a NEW session', async () => {
    const deps = fakeDeps({
      profile: [factEntry('writes a test alongside each feature', { sessionId: 'launch-A' })],
      matches: [match('add a logout route', 0.6)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('writes a test alongside each feature');
  });

  it('a recency-GUARANTEED episode survives ANY positive similarity floor (typed invariant, not a comment)', async () => {
    // THE invariant that used to live in comments across three files: memory2 hard-guarantees the
    // most-recent rows, which carry cosine 0. A caller-side floor must be structurally unable to drop
    // them — otherwise "what did we just do?" silently dies the day someone raises the floor.
    const deps = fakeDeps({ profile: [], matches: [match('what we just did', 0, true)] });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'what did we just do', minSimilarity: 0.5 });
    expect(out.episodeCount).toBe(1);
    expect(out.context).toContain('what we just did');
  });

  it('keeps a recency-only episode (similarity 0) when the floor is 0 — memory2 is the recall authority', async () => {
    // memory2's recall blend-ranks and GUARANTEES recent rows; a recency-only row carries cosine 0.
    // With floor 0 and an inclusive comparison, that row must survive (a strict > would nullify the
    // temporal-recall fix at the orchestrator).
    const deps = fakeDeps({ profile: [], matches: [match('what we just did', 0)] });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'what did we just do', minSimilarity: 0 });
    expect(out.episodeCount).toBe(1);
    expect(out.context).toContain('what we just did');
  });

  it('drops episodes below the similarity floor but keeps facts', async () => {
    const deps = fakeDeps({
      profile: [factEntry('prefers Zustand', { sessionId: 'launch-A' })],
      matches: [match('irrelevant', 0.1)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'state mgmt', minSimilarity: 0.3 });
    expect(out.episodeCount).toBe(0);
    expect(out.context).toContain('prefers Zustand');
  });

  it('uses the corrected active fact and drops the superseded old value', async () => {
    const deps = fakeDeps({
      profile: [
        factEntry('prefers vim', { id: 'old', superseded: true }),
        factEntry('prefers zed', { id: 'new' }),
      ],
      matches: [],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'editor' });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('prefers zed');
    expect(out.context).not.toContain('prefers vim');
  });

  it('does NOT leak another owner\'s facts', async () => {
    const deps = fakeDeps({
      profile: [factEntry('secret', { ownerId: 'someone-else', sessionId: 'x' })],
      matches: [],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'anything' });
    expect(out.factCount).toBe(0);
    expect(out.context).toBeUndefined();
  });

  it('keeps the durable facts when episodic recall fails (independent degradation)', async () => {
    const deps: RecallDeps = {
      getProfile: async () => [factEntry('writes a test alongside each feature')],
      recall: async () => { throw new Error('embedding service down'); },
    };
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.episodeCount).toBe(0);
    expect(out.context).toContain('writes a test alongside each feature');
  });

  it('keeps episodes when the profile fetch fails (independent degradation)', async () => {
    const deps: RecallDeps = {
      getProfile: async () => { throw new Error('profile read failed'); },
      recall: async () => [match('add a logout route', 0.9)],
    };
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(0);
    expect(out.episodeCount).toBe(1);
    expect(out.context).toContain('add a logout route');
  });
});
