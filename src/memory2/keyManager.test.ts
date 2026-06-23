import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateCipher, type KeyWrapper } from './keyManager';

// A reversible fake of the OS-keychain wrapper. `secret` stands in for the OS key — changing it
// simulates a keychain rotation that can no longer unwrap a previously-wrapped DEK.
function fakeWrapper(secret = 'os-key', avail = true): KeyWrapper {
  return {
    available: () => avail,
    describe: () => `fake(${secret})`,
    wrap: (buf) => `wrapped:${secret}:${buf.toString('base64')}`,
    unwrap: (tok) => {
      const [prefix, s, b64] = tok.split(':');
      if (prefix !== 'wrapped' || s !== secret) throw new Error('fake wrapper: cannot unwrap (wrong OS key)');
      return Buffer.from(b64, 'base64');
    },
  };
}

describe('keyManager — envelope DEK (wrapped by the OS keychain)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2key-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates + persists a wrapped DEK on first run, returning a working cipher', async () => {
    const cipher = await loadOrCreateCipher({ dir, wrapper: fakeWrapper() });
    const ct = cipher.encrypt('hello', 'aad');
    expect(cipher.decrypt(ct, 'aad')).toBe('hello');
    const keyPath = join(dir, 'key.json');
    expect(existsSync(keyPath)).toBe(true);
    const raw = readFileSync(keyPath, 'utf8');
    expect(raw).toContain('wrapped:'); // the DEK is stored WRAPPED, never raw
  });

  it('loads the SAME DEK across launches (a ciphertext from run 1 decrypts in run 2)', async () => {
    const c1 = await loadOrCreateCipher({ dir, wrapper: fakeWrapper() });
    const ct = c1.encrypt('cross-launch secret', 'aad');
    const c2 = await loadOrCreateCipher({ dir, wrapper: fakeWrapper() }); // fresh process, same dir + OS key
    expect(c2.decrypt(ct, 'aad')).toBe('cross-launch secret');
  });

  it('fails loud when the OS keychain is unavailable (encrypt-by-default cannot silently degrade)', async () => {
    await expect(loadOrCreateCipher({ dir, wrapper: fakeWrapper('os-key', false) })).rejects.toThrow(/keychain|unavailable/i);
  });

  it('fails loud (does NOT silently reinitialize) when the wrapped DEK cannot be unwrapped', async () => {
    await loadOrCreateCipher({ dir, wrapper: fakeWrapper('original-key') }); // persist a DEK wrapped under one key
    // The OS key changed: the wrapped DEK can no longer be recovered — must fail loud, not wipe + recreate.
    await expect(loadOrCreateCipher({ dir, wrapper: fakeWrapper('rotated-key') })).rejects.toThrow(/unrecoverable|locked|unwrap/i);
  });
});
