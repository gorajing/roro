import { describe, expect, it, vi } from 'vitest';
import {
  FactUnavailableError,
  factSource,
  fixFact,
  profileFacts,
  toProfileFactView,
  verifyFact,
  type ProfileFactDeps,
} from './profileFacts';
import type { Entry, FactPayload } from '../../shared/memory';

type ReplaceFactCall = Parameters<ProfileFactDeps['replaceFact']>[0];

function factEntry(
  id: string,
  key: string,
  value: string,
  over: Partial<Entry> = {},
): Entry {
  const payload: FactPayload = {
    key,
    value,
    source: { session_id: 'sess-1', turn_ts: 1718900000000 },
  };
  return {
    id,
    schemaVersion: 1,
    tier: 'fact',
    ownerId: 'owner-1',
    sessionId: 'sess-1',
    factKey: key,
    text: value,
    payload,
    confidence: 0.55,
    superseded: false,
    createdAt: '2026-06-21T00:00:00Z',
    ...over,
  };
}

function keyOf(entry: Entry): string | undefined {
  return (entry.payload as FactPayload | undefined)?.key;
}

function fakeDeps(seed: Entry[]) {
  const entries = seed.map((entry) => ({ ...entry }));
  const replaced: ReplaceFactCall[] = [];
  const reinforced: Array<{ ownerId: string; factKey: string }> = [];
  const deps: ProfileFactDeps = {
    getProfile: async (ownerId) =>
      entries.filter((entry) => entry.ownerId === ownerId && entry.tier === 'fact' && !entry.superseded),
    replaceFact: async (input) => {
      replaced.push(input);
      for (const entry of entries) {
        if (entry.ownerId === input.ownerId && keyOf(entry) === input.factKey && !entry.superseded) {
          entry.superseded = true;
        }
      }
      const entry = factEntry('replacement', input.factKey, input.text, {
        ownerId: input.ownerId,
        sessionId: input.sessionId,
        payload: input.payload,
        confidence: 0.5,
        createdAt: '2026-06-22T00:00:00Z',
      });
      entries.push(entry);
      return entry;
    },
    reinforceFact: async (input) => {
      reinforced.push(input);
      const entry = entries.find(
        (candidate) =>
          candidate.ownerId === input.ownerId &&
          candidate.tier === 'fact' &&
          keyOf(candidate) === input.factKey &&
          !candidate.superseded,
      );
      if (!entry) return null;
      entry.confidence = (entry.confidence ?? 0) + 0.1;
      return entry;
    },
  };
  return { entries, deps, replaced, reinforced };
}

describe('profileFacts trust helpers (Entry-based deps, FROZEN snake_case views)', () => {
  it('projects an active fact into a renderer-safe view', () => {
    const view = toProfileFactView(factEntry('f1', 'editor', 'uses Vim'));

    expect(view).toEqual({
      id: 'f1',
      key: 'editor',
      value: 'uses Vim',
      text: 'uses Vim',
      confidence: 0.55,
      created_at: '2026-06-21T00:00:00Z',
      source: { session_id: 'sess-1', turn_ts: 1718900000000 },
    });
    expect(view).not.toHaveProperty('ownerId');
    expect(view).not.toHaveProperty('owner_id');
    expect(view).not.toHaveProperty('payload');
  });

  it('tolerates historical camel-case source metadata', () => {
    const view = toProfileFactView(factEntry('f1', 'editor', 'uses Vim', {
      payload: { key: 'editor', value: 'uses Vim', source: { sessionId: 'camel', turnTs: 123 } } as unknown as FactPayload,
    }));

    expect(view.source).toEqual({ session_id: 'camel', turn_ts: 123 });
  });

  it('falls back to the structural factKey when the payload lost its key', () => {
    const view = toProfileFactView(factEntry('f1', 'editor', 'uses Vim', {
      payload: { value: 'uses Vim' } as unknown as FactPayload,
    }));
    expect(view.key).toBe('editor'); // Entry.factKey mirrors payload.key — the structural backup
  });

  it('lists only active facts for the current owner', async () => {
    const { deps } = fakeDeps([
      factEntry('mine', 'editor', 'uses Vim'),
      factEntry('old', 'editor', 'uses Emacs', { superseded: true }),
      factEntry('other', 'editor', 'uses Nano', { ownerId: 'owner-2' }),
      factEntry('episode', 'x', 'episode text', { tier: 'episode', factKey: undefined }),
    ]);

    const result = await profileFacts(deps, 'owner-1');

    expect(result.map((fact) => fact.id)).toEqual(['mine']);
  });

  it('fixes a fact by using the active owner-scoped entry key', async () => {
    const { deps, replaced } = fakeDeps([factEntry('f1', 'editor', 'uses Vim')]);

    const result = await fixFact(deps, 'owner-1', 'f1', '  uses Zed  ');

    expect(result).toMatchObject({ id: 'replacement', key: 'editor', value: 'uses Zed', text: 'uses Zed' });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toEqual({
      ownerId: 'owner-1',
      sessionId: 'sess-1',
      factKey: 'editor',
      text: 'uses Zed',
      payload: {
        key: 'editor',
        value: 'uses Zed',
        source: { session_id: 'sess-1', turn_ts: 1718900000000 },
      },
    });
  });

  it('rejects empty fixes before calling replaceFact', async () => {
    const { deps, replaced } = fakeDeps([factEntry('f1', 'editor', 'uses Vim')]);

    await expect(fixFact(deps, 'owner-1', 'f1', '   ')).rejects.toThrow('non-empty');

    expect(replaced).toHaveLength(0);
  });

  it('rejects stale or wrong-owner ids without calling replaceFact', async () => {
    const { deps, replaced } = fakeDeps([factEntry('other', 'editor', 'uses Vim', { ownerId: 'owner-2' })]);

    await expect(fixFact(deps, 'owner-1', 'other', 'uses Zed')).rejects.toBeInstanceOf(FactUnavailableError);

    expect(replaced).toHaveLength(0);
  });

  it('leaves the old active fact visible when replaceFact fails', async () => {
    const { deps } = fakeDeps([factEntry('f1', 'editor', 'uses Vim')]);
    deps.replaceFact = vi.fn().mockRejectedValueOnce(new Error('embed failed')) as ProfileFactDeps['replaceFact'];

    await expect(fixFact(deps, 'owner-1', 'f1', 'uses Zed')).rejects.toThrow('embed failed');

    expect((await profileFacts(deps, 'owner-1')).map((fact) => fact.text)).toEqual(['uses Vim']);
  });

  it('verifies a fact by reinforcing the stored key', async () => {
    const { deps, reinforced } = fakeDeps([factEntry('f1', 'editor', 'uses Vim')]);

    const result = await verifyFact(deps, 'owner-1', 'f1');

    expect(result).toMatchObject({ id: 'f1', key: 'editor', text: 'uses Vim' });
    expect(result.confidence).toBeCloseTo(0.65);
    expect(reinforced).toEqual([{ ownerId: 'owner-1', factKey: 'editor' }]);
  });

  it('returns safe source metadata without transcript content', async () => {
    const { deps } = fakeDeps([factEntry('f1', 'editor', 'uses Vim')]);

    await expect(factSource(deps, 'owner-1', 'f1')).resolves.toEqual({
      id: 'f1',
      source: { session_id: 'sess-1', turn_ts: 1718900000000 },
    });
  });
});

describe('executor-proposal provenance (channel/claimed_by/evidence) — never write-only', () => {
  const provEntry = () =>
    factEntry('p1', 'tests_location', 'keeps tests beside features', {
      payload: {
        key: 'tests_location',
        value: 'keeps tests beside features',
        source: {
          session_id: 'sess-1', turn_ts: 111,
          channel: 'executor', claimed_by: 'codex', evidence: 'keeps tests beside features',
        },
      },
    });

  it('sourceOf passes provenance through to the Source view (the trust surface must name WHO claimed it)', async () => {
    const { deps } = fakeDeps([provEntry()]);
    const view = await factSource(deps, 'owner-1', 'p1');
    expect(view.source).toMatchObject({ channel: 'executor', claimed_by: 'codex', evidence: 'keeps tests beside features' });
  });

  it('fixFact PRESERVES provenance when rewriting the value (a user fix must not erase who claimed it)', async () => {
    const { deps, replaced } = fakeDeps([provEntry()]);
    await fixFact(deps, 'owner-1', 'p1', 'keeps tests in __tests__');
    expect((replaced[0].payload as FactPayload).source).toMatchObject({ channel: 'executor', claimed_by: 'codex' });
  });
});
