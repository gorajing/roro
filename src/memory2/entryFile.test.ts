import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeEntry,
  parseEntry,
  computeContentHash,
  writeEntryFile,
  readEntryFile,
  entryPath,
} from './entryFile';
import type { Entry } from './types';

function fact(over: Partial<Entry> = {}): Entry {
  return {
    id: 'f1',
    schemaVersion: 1,
    tier: 'fact',
    ownerId: 'o1',
    text: 'uses pnpm',
    payload: { key: 'pkg', value: 'pnpm', source: { sessionId: 's1', turnTs: 1 } },
    createdAt: '2026-06-22T00:00:00.000Z',
    importance: 7,
    lineageIds: ['e1', 'e2'],
    ...over,
  };
}

describe('entryFile — files-as-truth durable I/O', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('serialize -> parse round-trips every field exactly', () => {
    const e = fact();
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  it('serializes as human-readable YAML frontmatter + a markdown body (the text)', () => {
    const s = serializeEntry(fact());
    expect(s.startsWith('---\n')).toBe(true);
    expect(s).toContain('tier: fact');
    expect(s).toContain('uses pnpm'); // the text lives in the body, not frontmatter
    // text must NOT be duplicated into the frontmatter
    expect(s.split('---')[1]).not.toContain('uses pnpm');
  });

  it('write -> read round-trips from disk at the tier-scoped path', async () => {
    const e = fact();
    const p = await writeEntryFile(dir, e);
    expect(p).toBe(entryPath(dir, e));
    expect(p).toContain(join('fact', 'f1.md'));
    expect(await readEntryFile(p)).toEqual(e);
  });

  it('content hash is stable for identical content and changes with the text', () => {
    const h = computeContentHash(fact());
    expect(computeContentHash(fact())).toBe(h);
    expect(computeContentHash(fact({ text: 'uses npm' }))).not.toBe(h);
  });

  it('writes atomically — no .tmp file is left behind', async () => {
    await writeEntryFile(dir, fact());
    expect(readdirSync(join(dir, 'fact'))).toEqual(['f1.md']);
  });
});
