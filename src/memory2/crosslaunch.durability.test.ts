// The canonical "magic moment" proof: a fact + episode taught in launch A must survive into launch B.
// TWO distinct guarantees, proven separately (an adversarial review caught the first version conflating
// them — it reopened the WARM persisted index, so the load-bearing files-as-truth path never ran):
//
//   1. NORMAL RESTART — launch B reopens the persisted PGlite index (reconcile replays 0 ops). Proves the
//      derived index is durable across a restart. This is the everyday path.
//   2. FILES-AS-TRUTH — the derived index is DELETED between launches; launch B must rebuild it by
//      decrypting the sealed entry files + the manifest/episode log. This is the architecturally
//      load-bearing claim (the index is derived + reconcilable; the encrypted files are the source of
//      truth) and the harder guarantee — if reconcile/decrypt-on-rebuild broke, ONLY this test fails.
//
// Deterministic + offline (no Ollama, no keychain): a fixed 32-byte cipher key (so launch B decrypts what
// A sealed) and a fake 16-dim embedder. Real semantic recall is the deferred OLLAMA_AVAILABLE live smoke.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory2Adapter, type Memory2Adapter } from './adapter';
import { createAesGcmCipher } from './cipher';
import { buildRecallContext } from '../main/memoryContext';

const DIM = 16;
// Deterministic unit vector keyed off the first char — same text → same vector across launches AND across
// a re-embed-on-rebuild, so the query cosine-matches the stored episode whether the index is warm or rebuilt.
const embed = async (t: string): Promise<number[]> => {
  const v = new Array<number>(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};
const OWNER = 'owner-A';
const FACT = 'writes a test alongside each feature';
const EPISODE = 'added a logout route';

/** Launch A: teach a durable fact + an episode, then CLOSE (seal everything to the encrypted files). */
async function teachThenClose(dir: string, cipher: ReturnType<typeof createAesGcmCipher>): Promise<void> {
  const a = await createMemory2Adapter({ dir, embed, dim: DIM, cipher });
  try {
    await a.replaceFact({
      owner_id: OWNER,
      session_id: 'launch-A',
      key: 'tests_with_features',
      text: FACT,
      payload: { key: 'tests_with_features', value: FACT },
    });
    await a.remember({ owner_id: OWNER, session_id: 'launch-A', kind: 'observation', text: EPISODE });
  } finally {
    await a.close();
  }
}

/** The launch-B assertions: the fact + episode + owner-isolation all survive into the reopened store. */
async function assertSurvives(b: Memory2Adapter): Promise<void> {
  // (A) the fact survives, and its payload round-trips through encrypt → close → reopen → decrypt
  const profile = await b.getProfile(OWNER);
  expect(profile.map((r) => r.text)).toEqual([FACT]);
  expect(profile[0].kind).toBe('fact');
  expect(profile[0].owner_id).toBe(OWNER);
  expect(profile[0].payload).toMatchObject({ key: 'tests_with_features', value: FACT });

  // (B) the episode is recalled, and facts don't leak into the episodic channel
  const hits = await b.recall({ query: EPISODE, ownerId: OWNER, k: 5 });
  expect(hits.map((hh) => hh.text)).toContain(EPISODE);
  expect(hits.every((hh) => hh.kind !== 'fact')).toBe(true);

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
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('survives a NORMAL restart — launch B reopens the persisted index with the fact + episode', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7)); // fixed key: B must decrypt what A sealed
    await teachThenClose(dir, cipher);

    const b = await createMemory2Adapter({ dir, embed, dim: DIM, cipher });
    try {
      await assertSurvives(b);
    } finally {
      await b.close();
    }
  });

  it('FILES-AS-TRUTH: with the derived index DELETED, launch B rebuilds it by decrypting the sealed files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mem2durable-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    await teachThenClose(dir, cipher);

    // Destroy ONLY the derived PGlite index — the durable encrypted files (manifest + entry files +
    // episode log) remain. Launch B must reconcile from applied_seq 0: read the manifest, open + DECRYPT
    // every sealed entry, re-embed, and rebuild the index. If that path were broken, this test fails
    // (the warm-restart test above would NOT — it never deletes the index).
    rmSync(join(dir, 'index'), { recursive: true, force: true });

    const b = await createMemory2Adapter({ dir, embed, dim: DIM, cipher });
    try {
      await assertSurvives(b);
    } finally {
      await b.close();
    }
  });
});
