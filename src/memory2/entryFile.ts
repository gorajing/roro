// src/memory2/entryFile.ts — files-as-truth durable I/O for a memory Entry.
//
// Durable tiers (core/fact) are stored one-file-per-entry as Markdown + YAML frontmatter so the user
// OWNS readable, grep-able, git-able memory (the index is a derived cache). Writes are DURABLE:
// fsync(tmp) -> rename -> fsync(dir), so a power-loss can't leave a half-written or lost entry. The
// content hash anchors dedup + integrity. (Episodes/traces use sharded JSONL — episodeLog.ts.)

import { open, rename, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { Entry } from './types';

/** Tier-scoped path: <dir>/<tier>/<id>.md */
export function entryPath(dir: string, entry: Entry): string {
  return join(dir, entry.tier, `${entry.id}.md`);
}

/** Markdown + YAML frontmatter: all fields except `text` go in frontmatter; `text` is the verbatim body. */
export function serializeEntry(entry: Entry): string {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'text' || v === undefined) continue; // text is the body; never emit undefined
    meta[k] = v;
  }
  // Exactly one blank line separates frontmatter from the body, and exactly one trailing newline is
  // added — parseEntry strips precisely those, so any whitespace INSIDE the body round-trips verbatim.
  return `---\n${yamlStringify(meta)}---\n\n${entry.text}\n`;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)\n$/;

export function parseEntry(content: string): Entry {
  const m = content.match(FRONTMATTER);
  if (!m) throw new Error('entryFile: missing/invalid YAML frontmatter');
  const meta = yamlParse(m[1]) as Record<string, unknown>;
  return { ...(meta as unknown as Entry), text: m[2] }; // body is exact (no trim) — whitespace is meaningful
}

/** Canonical serialization of the meaningful content (text + payload + tier + owner). MUST be computed
 *  over PLAINTEXT (before sealing) so the fingerprint is encryption-invariant + stable across key rotation. */
export function canonicalContent(entry: Entry): string {
  return JSON.stringify({
    text: entry.text,
    payload: entry.payload ?? null,
    tier: entry.tier,
    ownerId: entry.ownerId,
  });
}

/** Plaintext SHA-256 of the canonical content — used when encryption is OFF. When a cipher is present
 *  the writer uses cipher.fingerprint (keyed HMAC) instead, so low-entropy facts aren't guessable at rest. */
export function computeContentHash(entry: Entry): string {
  return createHash('sha256').update(canonicalContent(entry)).digest('hex');
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const dh = await open(dir, 'r');
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    /* some platforms reject fsync on a directory fd; best-effort (the file fsync below is the guarantee) */
  }
}

/** DURABLE atomic write: fsync the temp file, rename over the target, then fsync the directory. */
export async function writeEntryFile(dir: string, entry: Entry): Promise<string> {
  const path = entryPath(dir, entry);
  const tierDir = dirname(path);
  mkdirSync(tierDir, { recursive: true });
  const tmp = `${path}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(serializeEntry(entry), 'utf8');
    await fh.sync(); // flush the bytes to disk before the rename
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
  await fsyncDir(tierDir); // make the rename itself durable
  return path;
}

export async function readEntryFile(path: string): Promise<Entry> {
  return parseEntry(await readFile(path, 'utf8'));
}
