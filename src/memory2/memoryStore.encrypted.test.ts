import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
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
const KEY = Buffer.alloc(32, 7); // fixed key so cross-launch reopens decrypt
const cipher = createAesGcmCipher(KEY);

/** Every file under dir (recursive), as absolute paths. */
function allFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath ?? (d as unknown as { path: string }).path, d.name));
}

describe('memoryStore — encrypt-at-rest (cipher injected)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2enc-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes NO plaintext content to disk — files, JSONL, manifest, and the index all sealed', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM, cipher });
    await store.remember({ tier: 'episode', ownerId: 'o1', text: 'ZZSECRETEPISODE happened' });
    await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'ZZSECRETFACT value', payload: { key: 'editor', value: 'ZZSECRETFACT value' } });
    await store.close();
    const needleE = Buffer.from('ZZSECRETEPISODE');
    const needleF = Buffer.from('ZZSECRETFACT');
    for (const f of allFiles(dir)) {
      const buf = readFileSync(f);
      expect(buf.includes(needleE), `plaintext episode leaked in ${f}`).toBe(false);
      expect(buf.includes(needleF), `plaintext fact leaked in ${f}`).toBe(false);
    }
  });

  it('round-trips encrypted content through recall + getProfile (reads decrypt)', async () => {
    const store = await createMemoryStore({ dir, embed, dim: DIM, cipher });
    try {
      await store.remember({ tier: 'episode', ownerId: 'o1', text: 'added a logout route' });
      await store.replaceFact({ ownerId: 'o1', factKey: 'editor', text: 'prefers Neovim', payload: { key: 'editor', value: 'prefers Neovim' } });
      expect((await store.recall({ query: 'added a logout route', ownerId: 'o1', k: 5 })).map((h) => h.entry.text)).toContain('added a logout route');
      expect((await store.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toContain('added a logout route');
      const profile = await store.getProfile('o1');
      expect(profile.map((f) => f.text)).toEqual(['prefers Neovim']);
      expect(profile[0].payload).toEqual({ key: 'editor', value: 'prefers Neovim' }); // payload decrypts too
    } finally { await store.close(); }
  });

  it('cross-launch: reopening with the same cipher reads the encrypted corpus (reconcile opens sealed files)', async () => {
    const s1 = await createMemoryStore({ dir, embed, dim: DIM, cipher });
    await s1.remember({ tier: 'episode', ownerId: 'o1', text: 'persisted across restart' });
    await s1.replaceFact({ ownerId: 'o1', factKey: 'pkg', text: 'uses pnpm', payload: { key: 'pkg', value: 'uses pnpm' } });
    await s1.close();
    const s2 = await createMemoryStore({ dir, embed, dim: DIM, cipher }); // fresh index would force a sealed-file reconcile
    try {
      expect((await s2.recent({ ownerId: 'o1', k: 5 })).map((e) => e.text)).toContain('persisted across restart');
      expect((await s2.getProfile('o1')).map((f) => f.text)).toEqual(['uses pnpm']);
    } finally { await s2.close(); }
  });
});
