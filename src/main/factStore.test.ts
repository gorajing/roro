import { describe, it, expect, vi } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import type { MemoryRow, ReplaceFactInput, FactPayload } from '../shared/memory';

function factRow(id: string, key: string, value: string): MemoryRow {
  const payload: FactPayload = { key, value, source: { session_id: 'old', turn_ts: 0 } };
  return { id, owner_id: 'O', session_id: 'old', kind: 'fact', text: value, payload, superseded: false, created_at: '2026-06-21T00:00:00Z' };
}

const factKeyOf = (r: MemoryRow): string | undefined => (r.payload as FactPayload | null)?.key;

// Seed-only fake: replaceFact records its input and supersedes any matching seed row (the store's
// atomic supersede-all-for-key), so tests can assert on `replaced` and `superseded` directly.
function fakeDeps(seed: MemoryRow[]) {
  const replaced: ReplaceFactInput[] = [];
  const superseded: string[] = [];
  const reinforced: Array<{ owner_id: string; key: string }> = [];
  const deps: FactStoreDeps = {
    getProfile: async () => seed.filter((r) => !superseded.includes(r.id)),
    replaceFact: async (input) => {
      replaced.push(input);
      for (const r of seed) if (factKeyOf(r) === input.key && !superseded.includes(r.id)) superseded.push(r.id);
      return { ...factRow('new', input.key, input.text), owner_id: input.owner_id, session_id: input.session_id, payload: input.payload ?? null };
    },
    reinforceFact: async (input) => {
      reinforced.push(input);
      return seed.find((r) => factKeyOf(r) === input.key && !superseded.includes(r.id)) ?? null;
    },
  };
  return { deps, replaced, superseded, reinforced };
}

// A faithful store fake where replaceFact() mutates a shared row set (atomic supersede-all-for-key +
// insert), so getProfile() sees its effect — letting a read/write race actually manifest if it could.
function liveDeps() {
  const rows: MemoryRow[] = [];
  let n = 0;
  const deps: FactStoreDeps = {
    getProfile: async (ownerId) => rows.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded),
    replaceFact: async (input) => {
      // Atomic: supersede every prior active row for (owner, key), then insert the replacement.
      for (const r of rows) {
        if (r.owner_id === input.owner_id && r.kind === 'fact' && factKeyOf(r) === input.key && !r.superseded) r.superseded = true;
      }
      const row: MemoryRow = { id: `r${n++}`, owner_id: input.owner_id, session_id: input.session_id, kind: 'fact', text: input.text, payload: input.payload ?? null, superseded: false, created_at: new Date(n).toISOString() };
      rows.push(row);
      return row;
    },
    reinforceFact: async (input) =>
      rows.find((r) => r.owner_id === input.owner_id && r.kind === 'fact' && factKeyOf(r) === input.key && !r.superseded) ?? null,
  };
  return { rows, deps };
}

const CTX = { ownerId: 'O', sessionId: 'sess-B', turnTs: 1718900000000 };

describe('extractAndStoreFact', () => {
  it('writes nothing when the candidate is null', async () => {
    const { deps, replaced } = fakeDeps([]);
    await extractAndStoreFact(deps, null, CTX);
    expect(replaced).toHaveLength(0);
  });

  it('inserts a new source-linked fact when none exists for the key', async () => {
    const { deps, replaced, superseded } = fakeDeps([]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ owner_id: 'O', session_id: 'sess-B', text: 'uses pnpm', key: 'pkg_manager' });
    expect(replaced[0].payload).toEqual({ key: 'pkg_manager', value: 'uses pnpm', source: { session_id: 'sess-B', turn_ts: CTX.turnTs } });
  });

  it('replaces (supersedes old + inserts) when the value changes', async () => {
    const { deps, replaced, superseded } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses npm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toEqual(['r-old']);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].text).toBe('uses pnpm');
  });

  it('corroborates (reinforces, no churn) when the same key already has the same value', async () => {
    const { deps, replaced, superseded, reinforced } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses pnpm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0); // no supersede
    expect(replaced).toHaveLength(0); // no durable rewrite
    expect(reinforced).toEqual([{ owner_id: 'O', key: 'pkg_manager' }]); // confidence strengthened in place
  });

  it('repeated corrections for a key keep exactly one active fact (supersede-not-overwrite)', async () => {
    const { deps } = liveDeps();
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, CTX);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses yarn' }, CTX);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    const active = await deps.getProfile('O');
    expect(active.map((r) => r.text)).toEqual(['uses pnpm']); // collapses to exactly one active row
  });

  it('keeps the prior fact active when the replacement fails (no data loss)', async () => {
    const { deps } = liveDeps();
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, CTX); // one active fact
    // The atomic replace fails (embedding/network/DB error) — all-or-nothing, so nothing is mutated.
    deps.replaceFact = vi.fn().mockRejectedValueOnce(new Error('embed failed')) as FactStoreDeps['replaceFact'];

    await expect(extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).rejects.toThrow('embed failed');

    // The old fact must STILL be active — the replace is atomic and it failed.
    const active = await deps.getProfile('O');
    expect(active.map((r) => r.text)).toEqual(['uses npm']);
  });

  it('serializes concurrent same-key writes so only ONE active fact survives (no race)', async () => {
    const { deps } = liveDeps();
    // Two extractions for the same key racing (the orchestrator void-dispatches extraction and
    // does not serialize turns). The global write-chain makes them strictly sequential.
    await Promise.all([
      extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, { ownerId: 'O', sessionId: 's1', turnTs: 1 }),
      extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: 'O', sessionId: 's2', turnTs: 2 }),
    ]);
    const active = await deps.getProfile('O');
    expect(active.filter((r) => factKeyOf(r) === 'pkg_manager')).toHaveLength(1);
    expect(active[0].text).toBe('uses pnpm'); // the later writer wins; the earlier is superseded
  });
});
