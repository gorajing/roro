// The canonical "magic moment" proof: a fact + episode taught in launch A must survive into launch B.
// TWO distinct guarantees, proven separately — and RE-ARMED for the in-memory-index architecture,
// where the FULL manifest replays on EVERY open (files-as-truth is the normal path, not a recovery
// mode) and the vectorCache sidecar is what makes a warm open cheap:
//
//   1. NORMAL RESTART — launch B replays the manifest with the cache WARM. The re-armed assertion is
//      the load-bearing one: ZERO store-content embed calls at open (a counting embedder proves the
//      cache served every vector) AND cosine recall still ranks (the cached vectors are real).
//   2. FILES-AS-TRUTH — the derived index dir (engine state is in-memory; the dir holds the vector
//      cache) is DELETED between launches; launch B must rebuild by decrypting the sealed entry files
//      + the manifest/episode log and RE-EMBEDDING every live row (embeds ≥ live embeddable count).
//   3. DEGRADED OPEN — a cold open with a THROWING embedder still opens and serves getProfile +
//      recency recall (memory is degraded, never down), and SELF-HEALS on the next healthy launch
//      (the full replay re-consults the cache, misses, re-embeds).
//
// Plus the cache sabotage suite at the store seam: torn tail tolerated (zero re-embeds), interior
// corruption quarantined (open + re-embed, never crash), identity mismatch REFUSED with remedy text.
//
// Deterministic + offline (no Ollama, no keychain): a fixed 32-byte cipher key (so launch B decrypts
// what A sealed) and a fake 16-dim embedder. Real semantic recall is the deferred OLLAMA_AVAILABLE
// live smoke.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFacade, type MemoryFacade } from './index';
import { createMemoryStore } from './memoryStore';
import { createAesGcmCipher } from './cipher';
import { buildRecallContext } from '../main/memoryContext';

const DIM = 16;
// Deterministic unit vector keyed off the first char — same text → same vector across launches AND across
// a re-embed-on-rebuild, so the query cosine-matches the stored episode whether the cache is warm or cold.
const embed = async (t: string): Promise<number[]> => {
  const v = new Array<number>(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};
// The counting embedder: how the re-armed tests SEE whether the cache served (zero calls) or the
// files-as-truth rebuild ran (calls ≥ live embeddable rows).
const embedCalls: string[] = [];
const countingEmbed = async (t: string): Promise<number[]> => {
  embedCalls.push(t);
  return embed(t);
};
const OWNER = 'owner-A';
const FACT = 'writes a test alongside each feature';
const EPISODE = 'added a logout route';
const MODEL = 'nomic-embed-text';
const cachePath = (dir: string): string => join(dir, 'index', 'vectors.jsonl');

/** Launch A: teach a durable fact + an episode, then CLOSE (seal everything to the encrypted files). */
async function teachThenClose(dir: string, cipher: ReturnType<typeof createAesGcmCipher>): Promise<void> {
  const a = createMemoryFacade(await createMemoryStore({ dir, embed, dim: DIM, embedModel: MODEL, cipher }));
  try {
    await a.replaceFact({
      ownerId: OWNER,
      sessionId: 'launch-A',
      factKey: 'tests_with_features',
      text: FACT,
      payload: { key: 'tests_with_features', value: FACT },
    });
    await a.remember({ ownerId: OWNER, sessionId: 'launch-A', kind: 'observation', text: EPISODE });
  } finally {
    await a.close();
  }
}

async function reopen(dir: string, cipher: ReturnType<typeof createAesGcmCipher>, embedFn = countingEmbed): Promise<MemoryFacade> {
  return createMemoryFacade(await createMemoryStore({ dir, embed: embedFn, dim: DIM, embedModel: MODEL, cipher }));
}

/** The launch-B assertions: the fact + episode + owner-isolation all survive into the reopened store. */
async function assertSurvives(b: MemoryFacade): Promise<void> {
  // (A) the fact survives, and its payload round-trips through encrypt → close → reopen → decrypt
  const profile = await b.getProfile(OWNER);
  expect(profile.map((r) => r.text)).toEqual([FACT]);
  expect(profile[0].tier).toBe('fact');
  expect(profile[0].ownerId).toBe(OWNER);
  expect(profile[0].payload).toMatchObject({ key: 'tests_with_features', value: FACT });

  // (B) the episode is recalled BY COSINE (similarity ~1 proves a real vector served the match —
  // whether from the warm cache or a rebuild), and facts don't leak into the episodic channel
  const hits = await b.recall({ query: EPISODE, ownerId: OWNER, k: 5 });
  expect(hits.map((hh) => hh.entry.text)).toContain(EPISODE);
  expect(hits.find((hh) => hh.entry.text === EPISODE)?.similarity).toBeCloseTo(1, 5);
  expect(hits.every((hh) => hh.entry.tier !== 'fact')).toBe(true);

  // (C) the ACTUAL orchestrator-facing read path composes BOTH — the magic moment.
  // minSimilarity:0 because memory2's recency-guaranteed rows carry cosine 0 (a >0 floor drops them).
  const ctx = await buildRecallContext(b, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0 });
  expect(ctx.factCount).toBe(1);
  expect(ctx.context).toContain('KNOWN ABOUT THIS USER:');
  expect(ctx.context).toContain(FACT);
  expect(ctx.context).toContain(EPISODE);

  // (D) owner isolation survives the reopen — a different owner sees nothing
  expect(await b.getProfile('owner-B')).toEqual([]);
  const other = await buildRecallContext(b, { ownerId: 'owner-B', sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0 });
  expect(other.factCount).toBe(0);
  expect(other.context).toBeUndefined();
}

describe('memory2 cross-launch durability (the recalled-memory magic moment)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('survives a NORMAL restart with ZERO store-content embeds at open — the vector cache served', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7)); // fixed key: B must decrypt what A sealed
    await teachThenClose(dir, cipher);

    embedCalls.length = 0;
    const b = await reopen(dir, cipher);
    try {
      // The re-armed warm-open claim: the FULL manifest replayed, yet no store content was embedded —
      // every vector came from the cache. (Queries embed later; the count is taken right after open.)
      expect(embedCalls).toEqual([]);
      await assertSurvives(b); // includes: the EPISODE hit carries cosine ~1 (the cached vector is real)
    } finally {
      await b.close();
    }
  });

  it('FILES-AS-TRUTH: with the derived index dir DELETED, launch B rebuilds by decrypting + RE-EMBEDDING', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);

    // Destroy ONLY the derived layer (the vector cache lives here; the engine is in-memory anyway) —
    // the durable encrypted files (manifest + entry files + episode log) remain. Launch B must replay
    // from seq 0: read the manifest, open + DECRYPT every sealed entry, re-embed, rebuild.
    rmSync(join(dir, 'index'), { recursive: true, force: true });

    embedCalls.length = 0;
    const b = await reopen(dir, cipher);
    try {
      // The rebuild really embedded the live corpus (≥ every live embeddable row, from PLAINTEXT).
      expect(embedCalls).toContain(FACT);
      expect(embedCalls).toContain(EPISODE);
      expect(embedCalls.length).toBeGreaterThanOrEqual(2);
      await assertSurvives(b);
    } finally {
      await b.close();
    }
  });

  it('a COLD open with a THROWING embedder still opens and serves getProfile + recency recall', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);
    rmSync(join(dir, 'index'), { recursive: true, force: true }); // cold cache + embedder down = worst open

    const throwing = async (): Promise<number[]> => { throw new Error('embedder down'); };
    const b = await reopen(dir, cipher, throwing);
    try {
      expect((await b.getProfile(OWNER)).map((r) => r.text)).toEqual([FACT]); // the knows-you layer is up
      const hits = await b.recall({ query: 'what did we just do?', ownerId: OWNER, k: 5 });
      expect(hits.map((h) => h.entry.text)).toContain(EPISODE); // recency fallback — degraded, never down
    } finally {
      await b.close();
    }
  });

  it('an embed-outage open SELF-HEALS next launch: the full replay re-embeds the vectorless rows', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);
    rmSync(join(dir, 'index'), { recursive: true, force: true });

    // Launch B: embedder down — rows indexed vectorless, nothing cached.
    const throwing = async (): Promise<number[]> => { throw new Error('embedder down'); };
    const b = await reopen(dir, cipher, throwing);
    await b.close();

    // Launch C: embedder healthy. THE MECHANISM: every open replays the full manifest and indexEntry
    // consults the cache per row — the outage rows MISS and get re-embedded + cached. No separate
    // repair job exists (or is needed); this pins that.
    embedCalls.length = 0;
    const c = await reopen(dir, cipher);
    try {
      expect(embedCalls).toContain(EPISODE); // healed at open
      expect(embedCalls).toContain(FACT);
      await assertSurvives(c); // cosine recall is restored (similarity ~1)
    } finally {
      await c.close();
    }

    // And the heal is CACHED: launch D is a zero-embed warm open again.
    embedCalls.length = 0;
    const d = await reopen(dir, cipher);
    try {
      expect(embedCalls).toEqual([]);
    } finally {
      await d.close();
    }
  });
});

describe('memory2 vector-cache sabotage at the store seam (self-heal vs refusal)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('a torn cache tail (crash mid-append) is tolerated: warm reopen, zero re-embeds, full survival', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2sabotage-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);
    appendFileSync(cachePath(dir), '{"h":"torn-mid-wri'); // the crash artifact

    embedCalls.length = 0;
    const b = await reopen(dir, cipher);
    try {
      expect(embedCalls).toEqual([]); // both real vectors precede the torn tail — still a warm open
      await assertSurvives(b);
    } finally {
      await b.close();
    }
  });

  it('interior cache corruption → quarantine + fresh + loud warn; the open re-embeds and serves', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2sabotage-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);
    const lines = readFileSync(cachePath(dir), 'utf8').split('\n');
    lines[1] = '{"h":"mangled","v":"@@not-base64@@"}'; // a MIDDLE line — not a localizable crash artifact
    writeFileSync(cachePath(dir), lines.join('\n'), 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    embedCalls.length = 0;
    const b = await reopen(dir, cipher);
    try {
      expect(warn.mock.calls.some((args) => /quarantined/.test(String(args[0])))).toBe(true);
      expect(embedCalls.length).toBeGreaterThanOrEqual(2); // fresh cache → the corpus re-embedded
      expect(readdirSync(join(dir, 'index')).some((f) => f.includes('corrupt'))).toBe(true); // evidence kept
      await assertSurvives(b);
    } finally {
      await b.close();
    }
  });

  it('identity mismatch REFUSES the open with the actionable remedy (dimension and model, like the pglite guards)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2sabotage-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);

    await expect(createMemoryStore({ dir, embed, dim: 32, embedModel: MODEL, cipher })).rejects.toThrow(/dimension/i);
    await expect(createMemoryStore({ dir, embed, dim: 32, embedModel: MODEL, cipher })).rejects.toThrow(/not mixable/);
    await expect(createMemoryStore({ dir, embed, dim: DIM, embedModel: 'mxbai-embed-large', cipher })).rejects.toThrow(/model/i);

    const same = await reopen(dir, cipher); // the matching identity still opens fine
    try {
      expect((await same.getProfile(OWNER)).map((r) => r.text)).toEqual([FACT]);
    } finally {
      await same.close();
    }
  });
});
