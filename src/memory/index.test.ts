import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryStore, type MemoryStore, type Embedder } from './index';
import type { FactPayload } from '../shared/memory';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// Deterministic fake embedder: identical text -> identical 1536-dim vector (so the cosine
// similarity of a query against an identical stored text is ~1.0). The embedding seam is
// injected so the store is testable end-to-end against a REAL pgvector with no network.
const fakeEmbed: Embedder = async (text) => {
  const v = new Array(1536).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 1536] += text.charCodeAt(i) / 255;
  v[0] += 1; // keep the vector non-zero so cosine distance is always defined
  return v;
};

function fact(text: string, key = 'k'): { payload: FactPayload } {
  return { payload: { key, value: text, source: { session_id: 's1', turn_ts: 1 } } };
}

describe('PGlite memory store (owner-scoped)', () => {
  let store: MemoryStore;
  beforeEach(async () => {
    store = await createMemoryStore({ embed: fakeEmbed }); // in-memory (no dataDir)
  });
  afterEach(async () => {
    await store.close();
  });

  it('remember stamps owner_id + provenance and maps timestamptz to an ISO string', async () => {
    const row = await store.remember({
      owner_id: OWNER, session_id: 's1', kind: 'fact', text: 'uses pnpm', ...fact('uses pnpm', 'pkg'),
    });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(row.owner_id).toBe(OWNER);
    expect(row.superseded).toBe(false);
    expect(typeof row.created_at).toBe('string'); // Date -> ISO string mapping
    expect(() => new Date(row.created_at).toISOString()).not.toThrow();
    expect(row.embed_model).toBe('Qwen/Qwen3-Embedding-8B');
    expect(row.embed_dim).toBe(1536);
  });

  it('getProfile returns only the owner\'s active facts, newest first', async () => {
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'fact', text: 'first', ...fact('first', 'k1') });
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'fact', text: 'second', ...fact('second', 'k2') });
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'observation', text: 'not a fact' });
    await store.remember({ owner_id: OTHER, session_id: 's1', kind: 'fact', text: 'someone else', ...fact('someone else') });

    const profile = await store.getProfile(OWNER);
    expect(profile.map((r) => r.text)).toEqual(['second', 'first']); // newest first; no observation, no other owner
    expect(profile.every((r) => r.owner_id === OWNER && r.kind === 'fact')).toBe(true);
  });

  it('supersede hides a fact from getProfile (supersede-not-overwrite)', async () => {
    const row = await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'fact', text: 'old', ...fact('old') });
    await store.supersede(row.id);
    expect(await store.getProfile(OWNER)).toHaveLength(0);
  });

  it('recall is owner-scoped, excludes facts, and ranks by cosine similarity', async () => {
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'observation', text: 'add a logout route' });
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'observation', text: 'completely unrelated topic' });
    // A fact with identical text must NOT surface in recall (it has its own getProfile section).
    await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'fact', text: 'add a logout route', ...fact('add a logout route') });
    // Another owner's identical observation must NOT leak.
    await store.remember({ owner_id: OTHER, session_id: 's1', kind: 'observation', text: 'add a logout route' });

    const matches = await store.recall({ query: 'add a logout route', ownerId: OWNER });
    expect(matches.length).toBe(2); // two owner observations, no fact, no other owner
    expect(matches.every((m) => m.owner_id === OWNER)).toBe(true);
    expect(matches.every((m) => m.kind !== 'fact')).toBe(true);
    expect(matches[0].text).toBe('add a logout route'); // identical text -> top cosine rank
    expect(matches[0].similarity).toBeGreaterThan(0.99);
  });

  it('recall excludes superseded rows', async () => {
    const row = await store.remember({ owner_id: OWNER, session_id: 's1', kind: 'observation', text: 'add a logout route' });
    await store.supersede(row.id);
    const matches = await store.recall({ query: 'add a logout route', ownerId: OWNER });
    expect(matches).toHaveLength(0);
  });
});
