import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEpisode, readEpisodes, recentEpisodes, shardFor, shardPath } from './episodeLog';
import type { Entry } from './types';

function ep(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1', schemaVersion: 1, tier: 'episode', ownerId: 'o1',
    text: 'user asked to add a logout route', createdAt: '2026-06-22T10:00:00.000Z', seq: 1, ...over,
  };
}

describe('episodeLog — sharded JSONL (append-only, scales to 100k+)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2ep-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('append -> read round-trips episodes', async () => {
    await appendEpisode(dir, ep({ id: 'e1', seq: 1 }));
    await appendEpisode(dir, ep({ id: 'e2', seq: 2, text: 'ran the tests' }));
    const all = await readEpisodes(dir);
    expect(all.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('shards by month (YYYY-MM), so the log scales without one giant file', async () => {
    await appendEpisode(dir, ep({ id: 'a', createdAt: '2026-06-22T10:00:00.000Z' }));
    await appendEpisode(dir, ep({ id: 'b', createdAt: '2026-07-01T10:00:00.000Z' }));
    expect(shardFor('2026-06-22T10:00:00.000Z')).toBe('2026-06');
    expect(readdirSync(join(dir, 'episode')).sort()).toEqual(['2026-06.jsonl', '2026-07.jsonl']);
  });

  it('recentEpisodes returns newest-first by seq, owner-scoped, excludes tombstoned, respects limit', async () => {
    await appendEpisode(dir, ep({ id: 'e1', seq: 1 }));
    await appendEpisode(dir, ep({ id: 'e2', seq: 2 }));
    await appendEpisode(dir, ep({ id: 'e3', seq: 3 }));
    await appendEpisode(dir, ep({ id: 'gone', seq: 4, deletedAt: '2026-06-22T11:00:00.000Z' }));
    await appendEpisode(dir, ep({ id: 'other', seq: 5, ownerId: 'o2' }));
    const recent = await recentEpisodes(dir, 'o1', 2);
    expect(recent.map((e) => e.id)).toEqual(['e3', 'e2']); // newest two, no tombstone, no other owner
  });

  it('tolerates a torn/blank trailing line (crash mid-append)', async () => {
    await appendEpisode(dir, ep({ id: 'e1', seq: 1 }));
    appendFileSync(shardPath(dir, '2026-06'), '{"partial really borked'); // simulate a torn write
    const all = await readEpisodes(dir);
    expect(all.map((e) => e.id)).toEqual(['e1']); // the good line survives; the torn one is skipped
  });
});
