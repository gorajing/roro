import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVectorCache, l2Normalize, VECTOR_CACHE_FILE, type VectorCache } from './vectorCache';

const DIM = 8;
const MODEL = 'nomic-embed-text';
const unit = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));

describe('vectorCache — the zero-authority embeddings sidecar', () => {
  let dir = '';
  let cache: VectorCache | undefined;
  const path = (): string => join(dir, VECTOR_CACHE_FILE);
  const openCache = async (over: Partial<{ embedModel: string; dim: number }> = {}): Promise<VectorCache> => {
    cache = await openVectorCache({ dir, embedModel: MODEL, dim: DIM, ...over });
    return cache;
  };
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2vec-')); });
  afterEach(async () => {
    await cache?.close();
    cache = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips vectors by contentHash across a close + reopen (the warm-open payload)', async () => {
    const a = await openCache();
    await a.put('hash-a', unit(0));
    await a.put('hash-b', [3, 4, 0, 0, 0, 0, 0, 0]); // non-unit: must come back L2-normalized
    await a.close();
    cache = undefined;

    const b = await openCache();
    expect(b.size()).toBe(2);
    expect([...b.get('hash-a')!]).toEqual([...l2Normalize(unit(0))]);
    expect(b.get('hash-b')![0]).toBeCloseTo(0.6, 6);
    expect(b.get('hash-b')![1]).toBeCloseTo(0.8, 6);
    expect(b.get('missing')).toBeUndefined();
  });

  it('dedups by hash — re-putting the same content never grows the file (reinforce re-embeds)', async () => {
    const c = await openCache();
    await c.put('hash-a', unit(0));
    const before = readFileSync(path(), 'utf8');
    await c.put('hash-a', unit(0));
    await c.put('hash-a', unit(1)); // same hash ⇒ same content ⇒ ignored, not replaced
    await c.close();
    cache = undefined;
    expect(readFileSync(path(), 'utf8')).toBe(before);
  });

  it('PRIVACY: the file contains ONLY the header + {h, v} lines — no text/factKey/ownerId/id/seq, ever', async () => {
    const c = await openCache();
    await c.put('hmac-fingerprint-1', unit(0));
    await c.put('hmac-fingerprint-2', unit(3));
    await c.close();
    cache = undefined;

    const lines = readFileSync(path(), 'utf8').split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBe(3);
    // header: exactly {kind, v, embedModel, dim}
    const header = JSON.parse(lines[0]);
    expect(Object.keys(header).sort()).toEqual(['dim', 'embedModel', 'kind', 'v']);
    expect(header).toMatchObject({ kind: 'roro-vector-cache', v: 1, embedModel: MODEL, dim: DIM });
    // data lines: exactly {h, v} — the keyed-HMAC hash + the base64 vector, nothing else
    for (const line of lines.slice(1)) {
      const row = JSON.parse(line);
      expect(Object.keys(row).sort()).toEqual(['h', 'v']);
      expect(typeof row.h).toBe('string');
      expect(Buffer.from(row.v, 'base64').length).toBe(DIM * 4);
    }
  });

  // ---- identity refusal (class a) — the pglite dim/model guards, ported 1:1 ----

  it('fails loud when reopening a cache built for a different embedding DIMENSION', async () => {
    const a = await openCache();
    await a.put('hash-a', unit(0));
    await a.close();
    cache = undefined;
    await expect(openVectorCache({ dir, embedModel: MODEL, dim: 16 })).rejects.toThrow(/dimension/i);
    await expect(openVectorCache({ dir, embedModel: MODEL, dim: 16 })).rejects.toThrow(/not mixable/);
    const b = await openCache(); // same dim reopens fine
    expect(b.size()).toBe(1);
  });

  it('fails loud when reopening a cache built with a DIFFERENT embed model (same dim)', async () => {
    const a = await openCache();
    await a.put('hash-a', unit(0));
    await a.close();
    cache = undefined;
    await expect(openVectorCache({ dir, embedModel: 'mxbai-embed-large', dim: DIM })).rejects.toThrow(/model/i);
    await expect(openVectorCache({ dir, embedModel: 'mxbai-embed-large', dim: DIM })).rejects.toThrow(/not mixable/);
    const b = await openCache(); // same model reopens fine
    expect(b.size()).toBe(1);
  });

  // ---- self-heal (class b) — never crash the open ----

  it('missing file → cold open with a loud warn (fresh header written)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = await openCache();
    expect(c.size()).toBe(0);
    expect(warn.mock.calls.some((args) => /cold/.test(String(args[0])))).toBe(true);
    expect(readFileSync(path(), 'utf8')).toContain('roro-vector-cache');
  });

  it('torn TRAILING line (crash mid-append) → dropped AND truncated so later appends stay parseable', async () => {
    const a = await openCache();
    await a.put('hash-a', unit(0));
    await a.put('hash-b', unit(1));
    await a.close();
    cache = undefined;
    appendFileSync(path(), '{"h":"hash-c","v":"AAA'); // torn mid-write

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = await openCache();
    expect(b.size()).toBe(2); // tail dropped, the rest intact
    expect(warn.mock.calls.some((args) => /torn/.test(String(args[0])))).toBe(true);
    await b.put('hash-c', unit(2)); // append AFTER the truncation must land cleanly
    await b.close();
    cache = undefined;

    const c = await openCache(); // and the next open must NOT see interior corruption
    expect(c.size()).toBe(3);
    expect(readdirSync(dir).filter((f) => f.includes('corrupt'))).toEqual([]);
  });

  it('INTERIOR corruption → quarantine + fresh + loud warn (never crash, never trust the rest)', async () => {
    const a = await openCache();
    await a.put('hash-a', unit(0));
    await a.put('hash-b', unit(1));
    await a.close();
    cache = undefined;
    // Corrupt a MIDDLE line (line 2 of 3): unlike a torn tail, this is not a crash artifact we can localize.
    const lines = readFileSync(path(), 'utf8').split('\n');
    lines[1] = '{"h":"hash-a","v":"@@not-base64@@"}';
    writeFileSync(path(), lines.join('\n'), 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = await openCache();
    expect(b.size()).toBe(0); // fresh start — a corrupt cache is not trusted line-by-line
    expect(warn.mock.calls.some((args) => /quarantined/.test(String(args[0])))).toBe(true);
    const quarantined = readdirSync(dir).filter((f) => f.startsWith(`${VECTOR_CACHE_FILE}.corrupt-`));
    expect(quarantined.length).toBe(1); // evidence preserved, not deleted
  });

  it('bad/unparseable header → quarantine + fresh (self-heal, NOT an identity refusal)', async () => {
    writeFileSync(path(), 'not json at all\n', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = await openCache(); // must not throw — refusal is only for a PARSEABLE mismatching header
    expect(c.size()).toBe(0);
    expect(warn.mock.calls.some((args) => /quarantined/.test(String(args[0])))).toBe(true);
    expect(readdirSync(dir).some((f) => f.startsWith(`${VECTOR_CACHE_FILE}.corrupt-`))).toBe(true);
  });

  // ---- compact ----

  it('compact keeps only live hashes, rewrites atomically, and survives reopen', async () => {
    const a = await openCache();
    await a.put('live-1', unit(0));
    await a.put('dead-1', unit(1));
    await a.put('live-2', unit(2));
    await a.compact(new Set(['live-1', 'live-2']));
    expect(a.size()).toBe(2);
    expect(a.get('dead-1')).toBeUndefined();
    await a.put('live-3', unit(3)); // appends after a compact land in the NEW file (handle not stale)
    await a.close();
    cache = undefined;

    const content = readFileSync(path(), 'utf8');
    expect(content).not.toContain('dead-1');
    expect(existsSync(`${path()}.tmp`)).toBe(false); // tmp swapped away
    const b = await openCache();
    expect(b.size()).toBe(3);
    expect(b.get('live-3')).toBeDefined();
  });

  it('l2Normalize: unit output for any non-zero input; zero-norm stays zero (vectorless downstream)', () => {
    const v = l2Normalize([3, 0, 4, 0]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect([...l2Normalize([0, 0, 0, 0])]).toEqual([0, 0, 0, 0]);
  });
});
