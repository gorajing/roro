import { describe, it, expect, vi } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import type { Entry, FactPayload } from '../shared/memory';

type ReplaceFactCall = Parameters<FactStoreDeps['replaceFact']>[0];

function factEntry(id: string, key: string, value: string): Entry {
  const payload: FactPayload = { key, value, source: { session_id: 'old', turn_ts: 0 } };
  return { id, schemaVersion: 1, tier: 'fact', ownerId: 'O', sessionId: 'old', factKey: key, text: value, payload, superseded: false, createdAt: '2026-06-21T00:00:00Z' };
}

const factKeyOf = (e: Entry): string | undefined => (e.payload as FactPayload | null)?.key;

// Seed-only fake: replaceFact records its input and supersedes any matching seed row (the store's
// atomic supersede-all-for-key), so tests can assert on `replaced` and `superseded` directly.
function fakeDeps(seed: Entry[]) {
  const replaced: ReplaceFactCall[] = [];
  const superseded: string[] = [];
  const reinforced: Array<{ ownerId: string; factKey: string }> = [];
  const deps: FactStoreDeps = {
    getProfile: async () => seed.filter((e) => !superseded.includes(e.id)),
    replaceFact: async (input) => {
      replaced.push(input);
      for (const e of seed) if (factKeyOf(e) === input.factKey && !superseded.includes(e.id)) superseded.push(e.id);
      return { ...factEntry('new', input.factKey, input.text), ownerId: input.ownerId, sessionId: input.sessionId, payload: input.payload ?? null };
    },
    reinforceFact: async (input) => {
      reinforced.push(input);
      return seed.find((e) => factKeyOf(e) === input.factKey && !superseded.includes(e.id)) ?? null;
    },
  };
  return { deps, replaced, superseded, reinforced };
}

// A faithful store fake where replaceFact() mutates a shared row set (atomic supersede-all-for-key +
// insert), so getProfile() sees its effect — letting a read/write race actually manifest if it could.
function liveDeps() {
  const entries: Entry[] = [];
  let n = 0;
  const deps: FactStoreDeps = {
    getProfile: async (ownerId) => entries.filter((e) => e.ownerId === ownerId && e.tier === 'fact' && !e.superseded),
    replaceFact: async (input) => {
      // Atomic: supersede every prior active row for (owner, key), then insert the replacement.
      for (const e of entries) {
        if (e.ownerId === input.ownerId && e.tier === 'fact' && factKeyOf(e) === input.factKey && !e.superseded) e.superseded = true;
      }
      const entry: Entry = { id: `r${n++}`, schemaVersion: 1, tier: 'fact', ownerId: input.ownerId, sessionId: input.sessionId, factKey: input.factKey, text: input.text, payload: input.payload ?? null, superseded: false, createdAt: new Date(n).toISOString() };
      entries.push(entry);
      return entry;
    },
    reinforceFact: async (input) =>
      entries.find((e) => e.ownerId === input.ownerId && e.tier === 'fact' && factKeyOf(e) === input.factKey && !e.superseded) ?? null,
  };
  return { entries, deps };
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
    expect(replaced[0]).toMatchObject({ ownerId: 'O', sessionId: 'sess-B', text: 'uses pnpm', factKey: 'pkg_manager' });
    // The STORED payload shape is FROZEN (snake_case source) — the Memory panel reads it back.
    expect(replaced[0].payload).toEqual({ key: 'pkg_manager', value: 'uses pnpm', source: { session_id: 'sess-B', turn_ts: CTX.turnTs } });
  });

  it('replaces (supersedes old + inserts) when the value changes', async () => {
    const { deps, replaced, superseded } = fakeDeps([factEntry('r-old', 'pkg_manager', 'uses npm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toEqual(['r-old']);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].text).toBe('uses pnpm');
  });

  it('corroborates (reinforces, no churn) when the same key already has the same value', async () => {
    const { deps, replaced, superseded, reinforced } = fakeDeps([factEntry('r-old', 'pkg_manager', 'uses pnpm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0); // no supersede
    expect(replaced).toHaveLength(0); // no durable rewrite
    expect(reinforced).toEqual([{ ownerId: 'O', factKey: 'pkg_manager' }]); // confidence strengthened in place
  });

  it('repeated corrections for a key keep exactly one active fact (supersede-not-overwrite)', async () => {
    const { deps } = liveDeps();
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, CTX);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses yarn' }, CTX);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    const active = await deps.getProfile('O');
    expect(active.map((e) => e.text)).toEqual(['uses pnpm']); // collapses to exactly one active row
  });

  it('keeps the prior fact active when the replacement fails (no data loss)', async () => {
    const { deps } = liveDeps();
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses npm' }, CTX); // one active fact
    // The atomic replace fails (embedding/network/store error) — all-or-nothing, so nothing is mutated.
    deps.replaceFact = vi.fn().mockRejectedValueOnce(new Error('embed failed')) as FactStoreDeps['replaceFact'];

    await expect(extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).rejects.toThrow('embed failed');

    // The old fact must STILL be active — the replace is atomic and it failed.
    const active = await deps.getProfile('O');
    expect(active.map((e) => e.text)).toEqual(['uses npm']);
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
    expect(active.filter((e) => factKeyOf(e) === 'pkg_manager')).toHaveLength(1);
    expect(active[0].text).toBe('uses pnpm'); // the later writer wins; the earlier is superseded
  });

  // The return value is the discriminator the extraction TRACE records (gated/noop/stored/reinforced/
  // failed) so "Memory: 0 known facts" can be localized to the gate vs model vs store.
  describe('returns the outcome discriminator for the extraction trace', () => {
    it("returns 'noop' when the candidate is null (nothing written)", async () => {
      const { deps } = fakeDeps([]);
      expect(await extractAndStoreFact(deps, null, CTX)).toBe('noop');
    });
    it("returns 'stored' when a new fact is inserted", async () => {
      const { deps } = fakeDeps([]);
      expect(await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).toBe('stored');
    });
    it("returns 'stored' when the value changes (supersede + insert)", async () => {
      const { deps } = fakeDeps([factEntry('r-old', 'pkg_manager', 'uses npm')]);
      expect(await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).toBe('stored');
    });
    it("returns 'reinforced' when the same key already has the same value (no churn)", async () => {
      const { deps } = fakeDeps([factEntry('r-old', 'pkg_manager', 'uses pnpm')]);
      expect(await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX)).toBe('reinforced');
    });
  });
});
