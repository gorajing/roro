import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from './memoryStore';
import { createAesGcmCipher } from './cipher';

const DIM = 16;
const embed = async (t: string): Promise<number[]> => {
  const v = new Array(DIM).fill(0);
  v[(t.charCodeAt(0) || 0) % DIM] = 1;
  return v;
};

describe('memoryStore — reindex (the rebuildable-cache property: files+manifest -> index)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2reindex-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('rebuilds the index from files+manifest and does NOT resurrect pruned (tombstoned) episodes', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'old episode' });
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'new episode' });
      await store.pruneEpisodes({ ownerId: 'o1', maxLive: 1, keepNewest: 0, maxAgeDays: 99999 }); // tombstone 'old'
      expect((await store.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['new episode']);
      await store.reindex(); // a RAW JSONL reindex would resurrect 'old' (its line remains) — manifest-aware must not
      expect((await store.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['new episode']);
    } finally { await store.close(); }
  });

  it('rebuilds active facts and respects supersession', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    try {
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Neovim' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'Helix' }); // supersedes Neovim
      await store.reindex();
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['Helix']); // exactly one active fact
    } finally { await store.close(); }
  });

  it('preserves encrypt-at-rest — embeds from PLAINTEXT + stores SEALED, so recall still decrypts after a rebuild', async () => {
    const cipher = createAesGcmCipher(Buffer.alloc(32, 9));
    const store = await createMemoryStore({ dir, embed, dim: DIM, cipher });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'sealed episode' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'k', text: 'sealed fact' });
      await store.reindex();
      // If reindex had embedded the CIPHERTEXT, the plaintext query would not match → empty. It matches.
      expect((await store.recall({ query: 'sealed episode', ownerId: 'o1', k: 5 })).map((h) => h.entry.text)).toContain('sealed episode');
      expect((await store.getProfile('o1')).map((f) => f.text)).toEqual(['sealed fact']); // decrypts after rebuild
    } finally { await store.close(); }
  });

  it('marks embeddingStatus=failed on reindex when an embed fails (consistent with live indexEntry)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'boom' });
    await store.close();
    // Wipe the derived layer so the vector cache can't serve 'boom' (a warm cache would — correctly —
    // make the flaky embedder irrelevant; this test is about the MISS + failure path).
    rmSync(join(dir, 'index'), { recursive: true, force: true });
    // Reopen with an embedder that fails on 'boom', then rebuild — reindex must mark the row failed,
    // exactly like the incremental indexEntry path does (so a future re-embed retry sees both).
    const flaky = async (t: string): Promise<number[]> => { if (t === 'boom') throw new Error('embed down'); return embed(t); };
    const store2 = await createMemoryStore({ dir, embed: flaky, dim: DIM });
    try {
      await store2.reindex();
      const [row] = await store2.recent({ ownerId: 'o1', k: 5 }); // failed rows stay indexed (recency), just no vector
      expect(row.embeddingStatus).toBe('failed');
    } finally { await store2.close(); }
  });

  it('is idempotent — a second reindex (and a reopen) leaves the same live set', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'a' });
    await store.replaceFact({ ownerId: 'o1', factKey: 'k', text: 'b' });
    await store.reindex();
    await store.reindex();
    await store.close();
    const reopened = await createMemoryStore({ dir, embed, dim: DIM }); // the reopen replays the manifest; the live set must be identical
    try {
      expect((await reopened.recent({ ownerId: 'o1', k: 10 })).map((e) => e.text)).toEqual(['a']);
      expect((await reopened.getProfile('o1')).map((f) => f.text)).toEqual(['b']);
    } finally { await reopened.close(); }
  });
});
