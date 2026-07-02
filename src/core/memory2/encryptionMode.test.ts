import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEncryptionMode } from './encryptionMode';

describe('encryptionMode — a files-as-truth marker for the all-or-nothing encryption mode', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2encmode-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('stamps the mode in the STORE ROOT on first use (not the derived index)', async () => {
    await assertEncryptionMode(dir, true);
    const marker = join(dir, 'encryption.json');
    expect(existsSync(marker)).toBe(true); // a store-root file, survives an index rebuild
    expect(readFileSync(marker, 'utf8')).toContain('v1');
  });

  it('accepts a matching reopen, fails loud on a mismatch (both directions)', async () => {
    await assertEncryptionMode(dir, false); // plaintext store
    await expect(assertEncryptionMode(dir, false)).resolves.toBeUndefined(); // same mode ok
    await expect(assertEncryptionMode(dir, true)).rejects.toThrow(/encrypt/i); // plaintext store + cipher

    const enc = mkdtempSync(join(tmpdir(), 'mem2encmode2-'));
    try {
      await assertEncryptionMode(enc, true); // encrypted store
      await expect(assertEncryptionMode(enc, false)).rejects.toThrow(/encrypt/i); // encrypted store, no cipher
    } finally { rmSync(enc, { recursive: true, force: true }); }
  });

  it('fails loud on a malformed marker (corrupt JSON, or valid-JSON with a bad schema)', async () => {
    const marker = join(dir, 'encryption.json');
    for (const bad of ['not json', '{}', '{"version":1}', '{"mode":""}', '{"version":2,"mode":"v1"}']) {
      writeFileSync(marker, bad);
      await expect(assertEncryptionMode(dir, true)).rejects.toThrow(/corrupt|malformed/i); // never silently opens
    }
  });
});
