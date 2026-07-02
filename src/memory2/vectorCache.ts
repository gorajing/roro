// src/memory2/vectorCache.ts — the embeddings sidecar: a zero-authority disk CACHE of vectors.
//
// The in-memory index engine (memIndex.ts) holds no persistent state, so every launch rebuilds the
// index from the manifest (files-as-truth exercised on the NORMAL open path). This cache is what makes
// that cheap: a warm open replays the manifest with ZERO embed calls (hit by contentHash), a cold or
// damaged cache just re-embeds. It persists NO cursor and NO authority — losing the file, its tail, or
// any line means re-embedding, never data loss.
//
// File: `<indexDir>/vectors.jsonl` (the same index/ subdir PGlite used, so `rm -rf <dir>/index` keeps
// its exact meaning: destroy the derived layer, keep the durable files).
//   line 1 (header):  {"kind":"roro-vector-cache","v":1,"embedModel":"...","dim":N}
//   data lines:       {"h":"<contentHash>","v":"<base64 L2-normalized Float32Array LE>"}
// NOTHING else is ever written: no text, no factKey, no ownerId, no id, no seq (asserted by test).
// contentHash is the entry's stamped keyed-HMAC fingerprint (not reversible; see cipher.ts). The
// vectors themselves are plaintext BY DOCUMENTED DESIGN — the same embedding-inversion residual
// cipher.ts documents for the old index (KNN needs plaintext vectors; re-embedding per launch is the
// alternative, and the cache exists precisely to avoid that).
//
// OPEN rules — two classes, never conflated:
//   (a) IDENTITY REFUSAL: a parseable header whose (embedModel, dim) mismatches the config THROWS
//       (vector spaces are not mixable — the pglite guard's contract, ported 1:1).
//   (b) SELF-HEAL: missing file → cold + loud warn; torn TRAILING line → truncate the tail; interior
//       corruption / bad header → quarantine to vectors.jsonl.corrupt-<ts>, start fresh, loud warn.
//       NEVER crash the open.
//
// Durability: appends are NOT per-line fsync'd (zero-authority: a lost tail = a few re-embeds next
// open). fsync happens once in close() and after compact rewrites (atomic tmp → fsync → rename →
// fsync dir).

import { appendFile, mkdir, open, readFile, rename, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const VECTOR_CACHE_FILE = 'vectors.jsonl';
const HEADER_KIND = 'roro-vector-cache';
const HEADER_VERSION = 1;

interface CacheHeader {
  kind: typeof HEADER_KIND;
  v: number;
  embedModel: string;
  dim: number;
}

export interface VectorCache {
  /** Cached L2-normalized vector for a contentHash, or undefined (miss → the caller embeds). */
  get(contentHash: string): Float32Array | undefined;
  /** Write-through a freshly-embedded vector (L2-normalized before persisting). Deduped by hash —
   *  a reinforce/re-embed of identical content never grows the file. */
  put(contentHash: string, vector: ArrayLike<number>): Promise<void>;
  /** Number of cached vectors. */
  size(): number;
  /** Rewrite the file keeping only `liveHashes` (atomic tmp → fsync → rename → fsync dir). */
  compact(liveHashes: ReadonlySet<string>): Promise<void>;
  /** fsync the appended tail once, then release. */
  close(): Promise<void>;
}

/** L2-normalize into a Float32Array (float64 accumulator). A zero-norm input stays all-zero — the
 *  engine treats a zero vector as vectorless, so it can never pollute cosine ranking. */
export function l2Normalize(vec: ArrayLike<number>): Float32Array {
  let ss = 0;
  for (let i = 0; i < vec.length; i++) ss += vec[i] * vec[i];
  const norm = Math.sqrt(ss);
  const out = new Float32Array(vec.length);
  if (norm === 0) return out;
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Explicit little-endian codec (Float32Array's native view is platform-endian; the file format is LE). */
function encodeVec(vec: Float32Array): string {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf.toString('base64');
}

function decodeVec(b64: string, dim: number): Float32Array | undefined {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== dim * 4) return undefined;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function headerLine(embedModel: string, dim: number): string {
  const header: CacheHeader = { kind: HEADER_KIND, v: HEADER_VERSION, embedModel, dim };
  return `${JSON.stringify(header)}\n`;
}

function parseHeader(line: string): CacheHeader | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return undefined; }
  const h = parsed as Partial<CacheHeader> | null;
  if (!h || typeof h !== 'object' || h.kind !== HEADER_KIND || h.v !== HEADER_VERSION) return undefined;
  if (typeof h.embedModel !== 'string' || typeof h.dim !== 'number') return undefined;
  return h as CacheHeader;
}

/** Best-effort fsync of a directory (so a rename inside it is durable). */
async function fsyncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, 'r');
    try { await fh.sync(); } finally { await fh.close(); }
  } catch { /* best-effort: some platforms/filesystems refuse dir fsync — the rename itself is atomic */ }
}

/** IDENTITY REFUSAL (class a): same actionable message shape as the retired pglite guards — the
 *  /dimension/i and /model/i patterns and the "not mixable" remedy are contract, pinned by tests. */
function assertIdentity(header: CacheHeader, embedModel: string, dim: number): void {
  if (header.dim !== dim) {
    throw new Error(
      `memory2 vector cache embedding dimension is ${header.dim} but ${dim} was requested — ` +
        `vector spaces are not mixable; delete the index dir (the derived embeddings cache) to re-embed from files.`,
    );
  }
  if (header.embedModel !== embedModel) {
    throw new Error(
      `memory2 vector cache was built with embed model '${header.embedModel}' but '${embedModel}' is configured — ` +
        `same-dimension vector spaces are not mixable; delete the index dir (the derived embeddings cache) to re-embed from files.`,
    );
  }
}

export async function openVectorCache(opts: { dir: string; embedModel: string; dim: number }): Promise<VectorCache> {
  const { dir, embedModel, dim } = opts;
  const path = join(dir, VECTOR_CACHE_FILE);
  await mkdir(dir, { recursive: true });

  const vectors = new Map<string, Float32Array>();

  let raw: Buffer | undefined;
  try {
    raw = await readFile(path);
  } catch {
    raw = undefined; // missing → cold (class b)
  }

  if (raw === undefined) {
    console.warn(`[memory2] vector cache is cold (${path} missing) — this launch re-embeds the live corpus`);
    await writeFile(path, headerLine(embedModel, dim), 'utf8');
  } else {
    const lines = raw.toString('utf8').split('\n');
    let lastNonEmpty = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== '') { lastNonEmpty = i; break; }
    }

    const quarantine = async (reason: string): Promise<void> => {
      const to = `${path}.corrupt-${Date.now()}`;
      await rename(path, to);
      vectors.clear();
      await writeFile(path, headerLine(embedModel, dim), 'utf8');
      console.warn(`[memory2] vector cache ${reason} — quarantined to ${to}, starting fresh (re-embeds, no data loss)`);
    };

    const header = lastNonEmpty >= 0 ? parseHeader(lines[0]) : undefined;
    if (!header) {
      await quarantine('header is missing or unreadable');
    } else {
      assertIdentity(header, embedModel, dim); // class (a): a REFUSAL, never self-healed

      let corruptAt = -1; // first bad interior data line (→ quarantine)
      let tornTail = false; // bad FINAL line (→ truncate)
      for (let i = 1; i < lines.length; i++) {
        const s = lines[i].trim();
        if (!s) continue;
        let ok = false;
        try {
          const row = JSON.parse(s) as { h?: unknown; v?: unknown };
          if (typeof row.h === 'string' && typeof row.v === 'string') {
            const vec = decodeVec(row.v, dim);
            if (vec) { vectors.set(row.h, vec); ok = true; }
          }
        } catch { /* malformed line — classified below */ }
        if (!ok) {
          if (i === lastNonEmpty) { tornTail = true; break; }
          corruptAt = i + 1;
          break;
        }
      }

      if (corruptAt >= 0) {
        await quarantine(`has interior corruption at line ${corruptAt}`);
      } else if (tornTail) {
        // Drop the torn tail ON DISK too — otherwise the next append lands after a malformed line and
        // the following open would misclassify the whole file as interior-corrupt.
        const keep = lines.slice(0, lastNonEmpty).join('\n');
        await truncate(path, Buffer.byteLength(keep.endsWith('\n') || keep === '' ? keep : `${keep}\n`, 'utf8'));
        console.warn('[memory2] vector cache had a torn trailing line (crash mid-append) — dropped it (one re-embed at most)');
      }
    }
  }

  // Serialize appends so concurrent puts can't interleave lines.
  let tail: Promise<unknown> = Promise.resolve();
  const chain = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = tail.then(fn, fn);
    tail = r.then(() => undefined, () => undefined);
    return r;
  };

  return {
    get(contentHash: string): Float32Array | undefined {
      return vectors.get(contentHash);
    },

    put(contentHash: string, vector: ArrayLike<number>): Promise<void> {
      if (vectors.has(contentHash)) return Promise.resolve(); // dedup: no file growth
      const normalized = l2Normalize(vector);
      vectors.set(contentHash, normalized);
      return chain(() => appendFile(path, `${JSON.stringify({ h: contentHash, v: encodeVec(normalized) })}\n`, 'utf8'));
    },

    size(): number {
      return vectors.size;
    },

    compact(liveHashes: ReadonlySet<string>): Promise<void> {
      return chain(async () => {
        for (const h of [...vectors.keys()]) if (!liveHashes.has(h)) vectors.delete(h);
        const tmp = `${path}.tmp`;
        const body = [...vectors.entries()].map(([h, v]) => `${JSON.stringify({ h, v: encodeVec(v) })}\n`).join('');
        const fh = await open(tmp, 'w');
        try {
          await fh.writeFile(headerLine(embedModel, dim) + body, 'utf8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        await rename(tmp, path); // atomic swap
        await fsyncDir(dir);
      });
    },

    close(): Promise<void> {
      return chain(async () => {
        // One fsync for the whole appended tail (the only durability point appends get — by design).
        try {
          const fh = await open(path, 'r+');
          try { await fh.sync(); } finally { await fh.close(); }
        } catch { /* cache file gone (e.g. dir removed mid-run) — zero-authority, nothing to lose */ }
      });
    },
  };
}
