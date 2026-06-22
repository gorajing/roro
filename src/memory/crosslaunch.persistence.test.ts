import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, type Embedder } from './index';
import { extractAndStoreFact } from '../main/factStore';
import { buildRecallContext } from '../main/memoryContext';
import type { FactPayload } from '../shared/memory';

// Deterministic 1536-dim fake embedder (no network). Identical text -> identical vector.
const fakeEmbed: Embedder = async (text) => {
  const v = new Array(1536).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 1536] += text.charCodeAt(i) / 255;
  v[0] += 1;
  return v;
};

const OWNER = '11111111-1111-4111-8111-111111111111';

// The REAL spine across a REAL restart: a store on a persistent dataDir is the SAME engine the
// app uses. We write in "launch A", CLOSE the engine (PGlite is single-writer — must release the
// dir), then reopen a fresh instance on the SAME dataDir for "launch B". This is the automated
// equivalent of the manual "quit the app, relaunch, see the fact" check — no Insforge, no network.
describe('MEMORY SPINE — real PGlite persistence across launches', () => {
  let dir: string;
  let dbDir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roro-spine-'));
    dbDir = join(dir, 'db');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a fact taught in launch A survives a close/reopen and is recalled in launch B', async () => {
    // --- Launch A: teach one durable fact, then fully shut the engine down ---
    const launchA = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(
      launchA,
      { key: 'tests_with_features', value: 'writes a test alongside each feature' },
      { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 },
    );
    await launchA.close(); // releases the dataDir (single-writer)

    // --- Launch B: a brand-new engine on the SAME dataDir, fresh session, same owner ---
    const launchB = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    try {
      const out = await buildRecallContext(launchB, {
        ownerId: OWNER,
        sessionId: 'launch-B',
        query: 'add a logout route',
        minSimilarity: 0.3,
      });
      expect(out.factCount).toBe(1);
      expect(out.context).toContain('KNOWN ABOUT THIS USER:');
      expect(out.context).toContain('writes a test alongside each feature');

      // The persisted fact carries its launch-A provenance.
      const facts = await launchB.getProfile(OWNER);
      expect((facts[0].payload as FactPayload).source).toEqual({ session_id: 'launch-A', turn_ts: 1 });
    } finally {
      await launchB.close();
    }
  });

  it('a correction in launch B supersedes the launch-A value (no stale value resurfaces)', async () => {
    const launchA = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(launchA, { key: 'pkg_manager', value: 'uses npm' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    await launchA.close();

    const launchB = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(launchB, { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: OWNER, sessionId: 'launch-B', turnTs: 2 });
    await launchB.close();

    const launchC = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    try {
      const out = await buildRecallContext(launchC, { ownerId: OWNER, sessionId: 'launch-C', query: 'install deps', minSimilarity: 0.3 });
      expect(out.factCount).toBe(1);
      expect(out.context).toContain('uses pnpm');
      expect(out.context).not.toContain('uses npm');
    } finally {
      await launchC.close();
    }
  });

  it('a different owner on the same machine/db sees none of it', async () => {
    const launchA = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(launchA, { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    await launchA.close();

    const launchB = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    try {
      const out = await buildRecallContext(launchB, { ownerId: 'owner-B', sessionId: 'x', query: 'add a logout route' });
      expect(out.factCount).toBe(0);
      expect(out.context).toBeUndefined();
    } finally {
      await launchB.close();
    }
  });
});
