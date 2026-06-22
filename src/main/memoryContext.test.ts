import { describe, it, expect } from 'vitest';
import { composeMemoryContext, buildRecallContext, type RecallDeps } from './memoryContext';
import type { MemoryRow, MemoryMatch } from '../shared/memory';

const OWNER = 'owner-A';
function factRow(text: string, over: Partial<MemoryRow> = {}): MemoryRow {
  return { id: 'f', owner_id: OWNER, session_id: 's', kind: 'fact', text, payload: {}, superseded: false, created_at: '2026-06-21T00:00:00Z', ...over };
}
function match(text: string, similarity: number): MemoryMatch {
  return { ...factRow(text), kind: 'observation', similarity };
}

describe('composeMemoryContext', () => {
  it('labels facts separately from episodes', () => {
    const ctx = composeMemoryContext([factRow('writes a test alongside each feature')], [match('user asked to add a login route', 0.7)]);
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
    const ctx = composeMemoryContext([factRow('prefers Zustand')], []);
    expect(ctx).toContain('KNOWN ABOUT THIS USER:');
    expect(ctx).not.toContain('RELATED PAST CONTEXT:');
  });
});

describe('buildRecallContext (cross-launch: facts survive a session change)', () => {
  // An in-memory fake honoring owner-scoping + the similarity floor — the contract the live SQL implements.
  function fakeDeps(store: { profile: MemoryRow[]; matches: MemoryMatch[] }): RecallDeps {
    return {
      getProfile: async (ownerId) => store.profile.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded),
      recall: async ({ ownerId }) => store.matches.filter((m) => m.owner_id === ownerId),
    };
  }

  it('surfaces a prior-session fact in a NEW session', async () => {
    const deps = fakeDeps({
      profile: [factRow('writes a test alongside each feature', { session_id: 'launch-A' })],
      matches: [match('add a logout route', 0.6)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('writes a test alongside each feature');
  });

  it('drops episodes below the similarity floor but keeps facts', async () => {
    const deps = fakeDeps({
      profile: [factRow('prefers Zustand', { session_id: 'launch-A' })],
      matches: [match('irrelevant', 0.1)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'state mgmt', minSimilarity: 0.3 });
    expect(out.episodeCount).toBe(0);
    expect(out.context).toContain('prefers Zustand');
  });

  it('does NOT leak another owner\'s facts', async () => {
    const deps = fakeDeps({
      profile: [factRow('secret', { owner_id: 'someone-else', session_id: 'x' })],
      matches: [],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'anything' });
    expect(out.factCount).toBe(0);
    expect(out.context).toBeUndefined();
  });

  it('keeps the durable facts when episodic recall fails (independent degradation)', async () => {
    const deps: RecallDeps = {
      getProfile: async () => [factRow('writes a test alongside each feature')],
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
