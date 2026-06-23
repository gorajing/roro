import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { createMemoryStore, type Embedder, type MemoryStore } from './index';
import { SCHEMA_SQL, buildSchemaSql } from './schema';
import { extractAndStoreFact, type FactStoreDeps } from '../main/factStore';
import { buildRecallContext } from '../main/memoryContext';
import type { FactPayload } from '../shared/memory';

// The legacy store predates memory2's consolidation, so it has no reinforceFact. Shim a no-op to satisfy
// the FactStoreDeps contract — corroboration simply doesn't strengthen confidence on the old engine (the
// live path runs on memory2, which implements it). The legacy store is slated for retirement.
const factDeps = (s: MemoryStore): FactStoreDeps => ({
  getProfile: (o) => s.getProfile(o),
  replaceFact: (i) => s.replaceFact(i),
  reinforceFact: async () => null,
});

// Deterministic 768-dim fake embedder (no network). Identical text -> identical vector.
const fakeEmbed: Embedder = async (text) => {
  const v = new Array(768).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 768] += text.charCodeAt(i) / 255;
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
      factDeps(launchA),
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
    await extractAndStoreFact(factDeps(launchA), { key: 'pkg_manager', value: 'uses npm' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    await launchA.close();

    const launchB = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(factDeps(launchB), { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: OWNER, sessionId: 'launch-B', turnTs: 2 });
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

  it('fails loud when reopening a store whose embedding dimension no longer matches the embedder', async () => {
    // A legacy store built at vector(1536) (the Nebius era). create-table-if-not-exists cannot widen
    // or shrink an existing column, so a plain reopen would later fail cryptically on the first insert.
    const legacy = await PGlite.create(dbDir, { extensions: { vector } });
    await legacy.exec(buildSchemaSql(1536));
    await legacy.close();

    // Reopening with the default (768-dim nomic) embedder must throw a CLEAR, actionable error at
    // OPEN — vector spaces aren't mixable, so switching the embed model needs a deliberate re-embed.
    await expect(createMemoryStore({ dataDir: dbDir, embed: fakeEmbed })).rejects.toThrow(/dimension/i);
  });

  it('heals pre-existing duplicate active facts when (re)applying the unique-index schema', async () => {
    // A LEGACY store: the memory table WITHOUT the partial-unique index, carrying a duplicate the old
    // non-atomic insert-before-supersede path could leave (two active facts for the same owner+key).
    const db = await PGlite.create('memory://', { extensions: { vector } });
    await db.exec(`create extension if not exists vector;
      create table memory (
        id uuid primary key default gen_random_uuid(), seq bigserial,
        owner_id text not null, session_id text not null, kind text not null, text text not null,
        payload jsonb, superseded boolean not null default false,
        embed_model text, embed_dim int, embedding vector(768),
        created_at timestamptz not null default now());`);
    await db.exec(`insert into memory (owner_id, session_id, kind, text, payload) values
      ('O','s','fact','uses npm',  '{"key":"pkg"}'),
      ('O','s','fact','uses pnpm', '{"key":"pkg"}');`); // two ACTIVE facts, same (owner,key)

    // Applying the new schema must HEAL the duplicate AND build the unique index without throwing.
    await db.exec(SCHEMA_SQL);

    const active = await db.query<{ text: string }>(`select text from memory where kind='fact' and superseded=false order by seq`);
    expect(active.rows).toHaveLength(1); // collapsed to one active row
    expect(active.rows[0].text).toBe('uses pnpm'); // the newest (max seq) is kept
    await db.close();
  });

  it('a different owner on the same machine/db sees none of it', async () => {
    const launchA = await createMemoryStore({ dataDir: dbDir, embed: fakeEmbed });
    await extractAndStoreFact(factDeps(launchA), { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
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
