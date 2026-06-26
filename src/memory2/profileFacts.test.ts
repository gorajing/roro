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
import type { FactPayload, MemoryRow, ReplaceFactInput } from '../shared/memory';

function factRow(
  id: string,
  key: string,
  value: string,
  over: Partial<MemoryRow> = {},
): MemoryRow {
  const payload: FactPayload = {
    key,
    value,
    source: { session_id: 'sess-1', turn_ts: 1718900000000 },
  };
  return {
    id,
    owner_id: 'owner-1',
    session_id: 'sess-1',
    kind: 'fact',
    text: value,
    payload,
    confidence: 0.55,
    superseded: false,
    created_at: '2026-06-21T00:00:00Z',
    ...over,
  };
}

function keyOf(row: MemoryRow): string | undefined {
  return (row.payload as FactPayload | undefined)?.key;
}

function fakeDeps(seed: MemoryRow[]) {
  const rows = seed.map((row) => ({ ...row }));
  const replaced: ReplaceFactInput[] = [];
  const reinforced: Array<{ owner_id: string; key: string }> = [];
  const deps: ProfileFactDeps = {
    getProfile: async (ownerId) =>
      rows.filter((row) => row.owner_id === ownerId && row.kind === 'fact' && !row.superseded),
    replaceFact: async (input) => {
      replaced.push(input);
      for (const row of rows) {
        if (row.owner_id === input.owner_id && keyOf(row) === input.key && !row.superseded) {
          row.superseded = true;
        }
      }
      const row = factRow('replacement', input.key, input.text, {
        owner_id: input.owner_id,
        session_id: input.session_id,
        payload: input.payload,
        confidence: 0.5,
        created_at: '2026-06-22T00:00:00Z',
      });
      rows.push(row);
      return row;
    },
    reinforceFact: async (input) => {
      reinforced.push(input);
      const row = rows.find(
        (candidate) =>
          candidate.owner_id === input.owner_id &&
          candidate.kind === 'fact' &&
          keyOf(candidate) === input.key &&
          !candidate.superseded,
      );
      if (!row) return null;
      row.confidence = (row.confidence ?? 0) + 0.1;
      return row;
    },
  };
  return { rows, deps, replaced, reinforced };
}

describe('profileFacts trust helpers', () => {
  it('projects an active fact into a renderer-safe view', () => {
    const view = toProfileFactView(factRow('f1', 'editor', 'uses Vim'));

    expect(view).toEqual({
      id: 'f1',
      key: 'editor',
      value: 'uses Vim',
      text: 'uses Vim',
      confidence: 0.55,
      created_at: '2026-06-21T00:00:00Z',
      source: { session_id: 'sess-1', turn_ts: 1718900000000 },
    });
    expect(view).not.toHaveProperty('owner_id');
    expect(view).not.toHaveProperty('payload');
  });

  it('tolerates historical camel-case source metadata', () => {
    const view = toProfileFactView(factRow('f1', 'editor', 'uses Vim', {
      payload: { key: 'editor', value: 'uses Vim', source: { sessionId: 'camel', turnTs: 123 } },
    }));

    expect(view.source).toEqual({ session_id: 'camel', turn_ts: 123 });
  });

  it('lists only active facts for the current owner', async () => {
    const { deps } = fakeDeps([
      factRow('mine', 'editor', 'uses Vim'),
      factRow('old', 'editor', 'uses Emacs', { superseded: true }),
      factRow('other', 'editor', 'uses Nano', { owner_id: 'owner-2' }),
      factRow('episode', 'x', 'episode text', { kind: 'observation' }),
    ]);

    const result = await profileFacts(deps, 'owner-1');

    expect(result.map((fact) => fact.id)).toEqual(['mine']);
  });

  it('fixes a fact by using the active owner-scoped row key', async () => {
    const { deps, replaced } = fakeDeps([factRow('f1', 'editor', 'uses Vim')]);

    const result = await fixFact(deps, 'owner-1', 'f1', '  uses Zed  ');

    expect(result).toMatchObject({ id: 'replacement', key: 'editor', value: 'uses Zed', text: 'uses Zed' });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toEqual({
      owner_id: 'owner-1',
      session_id: 'sess-1',
      key: 'editor',
      text: 'uses Zed',
      payload: {
        key: 'editor',
        value: 'uses Zed',
        source: { session_id: 'sess-1', turn_ts: 1718900000000 },
      },
    });
  });

  it('rejects empty fixes before calling replaceFact', async () => {
    const { deps, replaced } = fakeDeps([factRow('f1', 'editor', 'uses Vim')]);

    await expect(fixFact(deps, 'owner-1', 'f1', '   ')).rejects.toThrow('non-empty');

    expect(replaced).toHaveLength(0);
  });

  it('rejects stale or wrong-owner ids without calling replaceFact', async () => {
    const { deps, replaced } = fakeDeps([factRow('other', 'editor', 'uses Vim', { owner_id: 'owner-2' })]);

    await expect(fixFact(deps, 'owner-1', 'other', 'uses Zed')).rejects.toBeInstanceOf(FactUnavailableError);

    expect(replaced).toHaveLength(0);
  });

  it('leaves the old active fact visible when replaceFact fails', async () => {
    const { deps } = fakeDeps([factRow('f1', 'editor', 'uses Vim')]);
    deps.replaceFact = vi.fn().mockRejectedValueOnce(new Error('embed failed')) as ProfileFactDeps['replaceFact'];

    await expect(fixFact(deps, 'owner-1', 'f1', 'uses Zed')).rejects.toThrow('embed failed');

    expect((await profileFacts(deps, 'owner-1')).map((fact) => fact.text)).toEqual(['uses Vim']);
  });

  it('verifies a fact by reinforcing the stored key', async () => {
    const { deps, reinforced } = fakeDeps([factRow('f1', 'editor', 'uses Vim')]);

    const result = await verifyFact(deps, 'owner-1', 'f1');

    expect(result).toMatchObject({ id: 'f1', key: 'editor', text: 'uses Vim' });
    expect(result.confidence).toBeCloseTo(0.65);
    expect(reinforced).toEqual([{ owner_id: 'owner-1', key: 'editor' }]);
  });

  it('returns safe source metadata without transcript content', async () => {
    const { deps } = fakeDeps([factRow('f1', 'editor', 'uses Vim')]);

    await expect(factSource(deps, 'owner-1', 'f1')).resolves.toEqual({
      id: 'f1',
      source: { session_id: 'sess-1', turn_ts: 1718900000000 },
    });
  });
});
