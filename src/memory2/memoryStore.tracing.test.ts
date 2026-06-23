import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';
import type { Tracer, TraceEvent } from './tracer';

const DIM = 16;
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};

function capturingTracer(): { tracer: Tracer; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return { tracer: { emit: (e) => events.push(e) }, events };
}

describe('memoryStore — tracing taps at each seam', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2tracetap-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('emits remember / recall (full candidate pool) / fact / supersede / prune — and no result text', async () => {
    const { tracer, events } = capturingTracer();
    const store = await createMemoryStore({ dir, embed, dim: DIM, tracer });
    try {
      const ep1 = await store.remember({ tier: 'episode', ownerId: 'o1', text: 'ran the migration' });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'wrote a test' }); // stays live for the prune
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Helix' }); // supersedes the prior fact
      await store.reinforceFact({ ownerId: 'o1', factKey: 'editor' });
      await store.recall({ query: 'what did we do', ownerId: 'o1', k: 5 });
      await store.supersede(ep1.id); // tap the supersede seam
      await store.pruneEpisodes({ ownerId: 'o1', maxLive: 0, keepNewest: 0, maxAgeDays: 0 }); // prunes the live one

      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain('remember');
      expect(kinds).toContain('recall');
      expect(kinds).toContain('supersede');
      expect(kinds).toContain('prune');
      const facts = events.filter((e): e is Extract<TraceEvent, { kind: 'fact' }> => e.kind === 'fact');
      expect(facts.map((f) => f.op).sort()).toEqual(['reinforce', 'replace', 'replace']);
      // the fact-replace logs the superseded prior id (lineage)
      const secondReplace = facts.filter((f) => f.op === 'replace')[1];
      expect(secondReplace.supersededIds?.length).toBe(1);

      // recall logs the FULL candidate pool's explainable components + returned flag, never the memory text
      const recall = events.find((e): e is Extract<TraceEvent, { kind: 'recall' }> => e.kind === 'recall')!;
      expect(recall.query).toBe('what did we do');
      expect(recall.candidates[0]).toHaveProperty('parts');
      expect(recall.candidates[0]).toHaveProperty('returned');
      expect(JSON.stringify(recall)).not.toContain('ran the migration'); // ids + scores only, no result text
    } finally { await store.close(); }
  });

  it('defaults to a no-op tracer (no tracer injected) without error', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'no tracer here' });
      expect((await store.recent({ ownerId: 'o1', k: 1 }))[0].text).toBe('no tracer here');
    } finally { await store.close(); }
  });
});
