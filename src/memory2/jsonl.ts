// src/memory2/jsonl.ts — durable append + integrity-checked parse for append-only JSONL files
// (the manifest journal and the episode/trace shards).
//
// Durability: each append fsyncs before returning. Integrity: a torn TRAILING line (a crash mid-append)
// is tolerated, but interior corruption FAILS LOUD — silently dropping a committed middle line would
// erase history and corrupt seq accounting (Codex finding). The manifest is the durability authority.

import { open } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Durable append of one JSON line (fsync before return). Creates the parent dir if needed. */
export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const fh = await open(path, 'a');
  try {
    await fh.writeFile(`${JSON.stringify(obj)}\n`, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Parse JSONL content. Tolerates a single malformed FINAL non-empty line (torn trailing write);
 * throws on any interior corruption (fail loud — never silently drop committed history).
 */
export function parseJsonlLines<T>(content: string, what: string): T[] {
  const lines = content.split('\n');
  let lastNonEmpty = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') { lastNonEmpty = i; break; }
  }
  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch (err) {
      if (i === lastNonEmpty) break; // torn trailing line — tolerated
      throw new Error(`${what}: interior corruption at line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return out;
}
