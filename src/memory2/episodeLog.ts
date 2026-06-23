// src/memory2/episodeLog.ts — sharded append-only JSONL store for the episode + trace tiers.
//
// High-volume turn history; file-per-entry doesn't scale to 100k+, so entries live in month-sharded
// JSONL (one JSON Entry per line), one subdir per tier (episode/trace — never mixed). Appends are
// durable (fsync) and interior corruption fails loud (jsonl.ts). The recency path scans NEWEST shards
// backward and stops early, so "what did we just do?" stays fast across years of episodes.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendJsonl, parseJsonlLines } from './jsonl';
import type { Entry, Tier } from './types';

/** Only these tiers live in the JSONL log; core/fact are durable per-file entries. */
type LogTier = Extract<Tier, 'episode' | 'trace'>;

/** Month shard key (YYYY-MM) from an ISO timestamp. */
export function shardFor(createdAtIso: string): string {
  return createdAtIso.slice(0, 7);
}

export function shardPath(dir: string, shard: string, tier: LogTier = 'episode'): string {
  return join(dir, tier, `${shard}.jsonl`);
}

export async function appendEpisode(dir: string, entry: Entry): Promise<void> {
  if (entry.tier !== 'episode' && entry.tier !== 'trace') {
    throw new Error(`episodeLog: tier '${entry.tier}' is not a log tier (use the durable entry store)`);
  }
  await appendJsonl(shardPath(dir, shardFor(entry.createdAt), entry.tier), entry);
}

async function listShards(dir: string, tier: LogTier): Promise<string[]> {
  try {
    return (await readdir(join(dir, tier))).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return []; // no tier dir yet
  }
}

/** All entries of a tier across shards (chronological). Interior corruption throws (jsonl.ts). */
export async function readEpisodes(dir: string, tier: LogTier = 'episode'): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const f of await listShards(dir, tier)) {
    const content = await readFile(join(dir, tier, f), 'utf8');
    out.push(...parseJsonlLines<Entry>(content, `${tier} shard ${f}`));
  }
  return out;
}

/**
 * Most-recent live entries for an owner, newest-first by seq — the temporal/meta recall path.
 * Scans newest shards backward and stops once `limit` owner matches are collected (seq is monotonic
 * with time and shards are chronological, so older shards cannot outrank a newer one).
 */
export async function recentEpisodes(
  dir: string,
  ownerId: string,
  limit: number,
  tier: LogTier = 'episode',
): Promise<Entry[]> {
  const shards = (await listShards(dir, tier)).reverse(); // newest month first
  const collected: Entry[] = [];
  for (const f of shards) {
    const content = await readFile(join(dir, tier, f), 'utf8');
    const rows = parseJsonlLines<Entry>(content, `${tier} shard ${f}`);
    for (let i = rows.length - 1; i >= 0; i--) {
      const e = rows[i];
      if (e.ownerId === ownerId && !e.deletedAt) collected.push(e);
    }
    if (collected.length >= limit) break; // enough; older shards can't outrank these
  }
  collected.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || b.createdAt.localeCompare(a.createdAt));
  return collected.slice(0, limit);
}
