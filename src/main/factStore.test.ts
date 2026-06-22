import { describe, it, expect, vi } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import type { MemoryRow, RememberInput, FactPayload } from '../shared/memory';

function factRow(id: string, key: string, value: string): MemoryRow {
  const payload: FactPayload = { key, value, source: { session_id: 'old', turn_ts: 0 } };
  return { id, owner_id: 'O', session_id: 'old', kind: 'fact', text: value, payload, superseded: false, created_at: '2026-06-21T00:00:00Z' };
}

function fakeDeps(seed: MemoryRow[]) {
  const inserts: RememberInput[] = [];
  const superseded: string[] = [];
  const deps: FactStoreDeps = {
    getProfile: async () => seed.filter((r) => !superseded.includes(r.id)),
    remember: async (input) => { inserts.push(input); return { ...factRow('new', 'k', 'v'), ...input } as unknown as MemoryRow; },
    supersede: async (id) => { superseded.push(id); },
  };
  return { deps, inserts, superseded };
}

// A faithful store fake where remember() is visible to a later getProfile() (unlike the seed-only
// fakeDeps above) — so a read/supersede/insert race actually manifests as duplicate active facts.
function liveDeps() {
  const rows: MemoryRow[] = [];
  let n = 0;
  const factKeyOf = (r: MemoryRow) => (r.payload as FactPayload | null)?.key;
  const deps: FactStoreDeps = {
    getProfile: async (ownerId) => rows.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded),
    remember: async (input) => {
      const row: MemoryRow = { id: `r${n++}`, owner_id: input.owner_id, session_id: input.session_id, kind: input.kind, text: input.text, payload: input.payload ?? null, superseded: false, created_at: new Date(n).toISOString() };
      rows.push(row);
      return row;
    },
    supersede: async (id) => { const r = rows.find((x) => x.id === id); if (r) r.superseded = true; },
  };
  return { rows, deps, factKeyOf };
}

const CTX = { ownerId: 'O', sessionId: 'sess-B', turnTs: 1718900000000 };

describe('extractAndStoreFact', () => {
  it('writes nothing when the candidate is null', async () => {
    const { deps, inserts } = fakeDeps([]);
    await extractAndStoreFact(deps, null, CTX);
    expect(inserts).toHaveLength(0);
  });

  it('inserts a new source-linked fact when none exists for the key', async () => {
    const { deps, inserts, superseded } = fakeDeps([]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ owner_id: 'O', session_id: 'sess-B', kind: 'fact', text: 'uses pnpm' });
    expect(inserts[0].payload).toEqual({ key: 'pkg_manager', value: 'uses pnpm', source: { session_id: 'sess-B', turn_ts: CTX.turnTs } });
  });

  it('supersedes the old row then inserts when the value changes', async () => {
    const { deps, inserts, superseded } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses npm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toEqual(['r-old']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].text).toBe('uses pnpm');
  });

  it('is a no-op when the same key already has the same value', async () => {
    const { deps, inserts, superseded } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses pnpm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('heals a pre-existing duplicate: a correction supersedes ALL prior active rows for the key', async () => {
    const { deps } = liveDeps();
    // Two active rows for one key — the residue a supersede-after-insert failure could leave behind.
    await deps.remember({ owner_id: 'O', session_id: 's', kind: 'fact', text: 'uses npm', payload: { key: 'pkg_manager', value: 'uses npm', source: { session_id: 's', turn_ts: 0 } } });
    await deps.remember({ owner_id: 'O', session_id: 's', kind: 'fact', text: 'uses yarn', payload: { key: 'pkg_manager', value: 'uses yarn', source: { session_id: 's', turn_ts: 1 } } });
    expect(await deps.getProfile('O')).toHaveLength(2);

    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);

    const active = await deps.getProfile('O');
    expect(active.map((r) => r.text)).toEqual(['uses pnpm']); // collapses to exactly one active row
  });

  it('keeps the prior fact active when the replacement insert fails (no data loss)', async () => {
    const { deps } = liveDeps();
    // An existing active fact for the key.
    await deps.remember({ owner_id: 'O', session_id: 's0', kind: 'fact', text: 'uses npm', payload: { key: 'pkg_manager', value: 'uses npm', source: { session_id: 's0', turn_ts: 0 } } });
    // The replacement insert fails (e.g. embedding/network/DB error).
    deps.remember = vi.fn().mockRejectedValueOnce(new Error('embed failed')) as FactStoreDeps['remember'];

    await expect(extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).rejects.toThrow('embed failed');

    // The old fact must STILL be active — supersede must not fire before the replacement is stored.
    const active = await deps.getProfile('O');
    expect(active.map((r) => r.text)).toEqual(['uses npm']);
  });

  it('serializes concurrent same-key writes so only ONE active fact survives (no race)', async () => {
    const { deps, factKeyOf } = liveDeps();
    // Two extractions for the same key racing (the orchestrator void-dispatches extraction and
    // does not serialize turns). Without serialization both read "no existing row" and insert.
    await Promise.all([
      extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, { ownerId: 'O', sessionId: 's1', turnTs: 1 }),
      extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: 'O', sessionId: 's2', turnTs: 2 }),
    ]);
    const active = await deps.getProfile('O');
    expect(active.filter((r) => factKeyOf(r) === 'pkg_manager')).toHaveLength(1);
    expect(active[0].text).toBe('uses pnpm'); // the later writer wins; the earlier is superseded
  });
});
