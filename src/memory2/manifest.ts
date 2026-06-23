// src/memory2/manifest.ts — the append-only durability journal + monotonic seq allocator.
//
// The crash-safe write contract (enforced by store.ts, not by these primitives): write the content
// file (durable) -> append a 'put'/'delete' op here (durable) -> update the derived index. On startup,
// reconcile files > manifest > DB (the DB never wins). The manifest is the single source of ORDER (the
// `seq` recency key) and of intent. Appends are fsync'd; interior corruption fails loud (see jsonl.ts).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendJsonl, parseJsonlLines } from './jsonl';
import type { Entry, Tier } from './types';

export interface ManifestOp {
  seq: number;
  op: 'put' | 'delete' | 'replace_fact';
  id: string;
  tier: Tier;
  ownerId: string;
  contentHash?: string;
  ts: string; // ISO-8601
  /** replace_fact (a compound WAL op): the fresh fact's full content, so reconcile can REDO the whole
   *  supersede-priors-then-insert atomically even if the process died mid-materialization. */
  entry?: Entry;
  /** replace_fact: the prior active fact ids this op supersedes. */
  supersedeIds?: string[];
}

export function manifestPath(dir: string): string {
  return join(dir, 'manifest.jsonl');
}

export async function appendOp(dir: string, op: ManifestOp): Promise<void> {
  await appendJsonl(manifestPath(dir), op);
}

export async function readManifest(dir: string): Promise<ManifestOp[]> {
  let content: string;
  try {
    content = await readFile(manifestPath(dir), 'utf8');
  } catch {
    return []; // no manifest yet
  }
  return parseJsonlLines<ManifestOp>(content, 'manifest');
}

/** Monotonic recency key: max committed seq + 1 (single-writer via store.ts; survives reopen). */
export async function nextSeq(dir: string): Promise<number> {
  const ops = await readManifest(dir);
  let max = 0;
  for (const o of ops) if (typeof o.seq === 'number' && o.seq > max) max = o.seq;
  return max + 1;
}
