import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSafeStorageWrapper, type SafeStorageLike } from './safeStorageWrapper';
import { loadOrCreateCipher } from './keyManager';

// A fake safeStorage: encryptString/decryptString round-trip via a reversible transform (NOT real crypto
// — just enough to exercise the wrapper's base64 + backend logic).
function fakeSafeStorage(over: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => { throw new Error('sync safeStorage availability should not be used'); },
    encryptString: () => { throw new Error('sync safeStorage encryption should not be used'); },
    decryptString: () => { throw new Error('sync safeStorage decryption should not be used'); },
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptStringAsync: async (b) => ({ shouldReEncrypt: false, result: b.toString('utf8').replace(/^enc:/, '') }),
    ...over,
  };
}

describe('buildSafeStorageWrapper — production KeyWrapper over Electron safeStorage', () => {
  it('wraps + unwraps a DEK round-trip (binary safe via base64)', async () => {
    const w = buildSafeStorageWrapper(fakeSafeStorage(), 'darwin');
    const dek = Buffer.from([0, 1, 2, 255, 128, 64]);
    expect(await w.unwrap(await w.wrap(dek))).toEqual(dek);
  });

  it('is available on macOS/Windows when async encryption is available', async () => {
    await expect(buildSafeStorageWrapper(fakeSafeStorage(), 'darwin').available()).resolves.toBe(true);
    await expect(buildSafeStorageWrapper(fakeSafeStorage(), 'win32').available()).resolves.toBe(true);
  });

  it('is unavailable when async safeStorage reports no encryption', async () => {
    const w = buildSafeStorageWrapper(fakeSafeStorage({ isAsyncEncryptionAvailable: async () => false }), 'darwin');
    await expect(w.available()).resolves.toBe(false);
  });

  it('uses async safeStorage methods without touching sync Keychain methods', async () => {
    const isEncryptionAvailable = vi.fn(() => { throw new Error('sync availability should not be called'); });
    const encryptString = vi.fn(() => { throw new Error('sync encrypt should not be called'); });
    const decryptString = vi.fn(() => { throw new Error('sync decrypt should not be called'); });
    const w = buildSafeStorageWrapper(fakeSafeStorage({
      isEncryptionAvailable,
      encryptString,
      decryptString,
    }), 'darwin');

    await expect(w.available()).resolves.toBe(true);
    const dek = Buffer.from([9, 8, 7]);
    expect(await w.unwrap(await w.wrap(dek))).toEqual(dek);
    expect(isEncryptionAvailable).not.toHaveBeenCalled();
    expect(encryptString).not.toHaveBeenCalled();
    expect(decryptString).not.toHaveBeenCalled();
  });

  it('fails before key creation when async encryption is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem2-safe-storage-'));
    const encryptStringAsync = vi.fn(async () => Buffer.from('should-not-be-called'));
    const w = buildSafeStorageWrapper(fakeSafeStorage({
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync,
    }), 'darwin');

    try {
      await expect(loadOrCreateCipher({ dir, wrapper: w })).rejects.toThrow(/keychain|unavailable/i);
      expect(encryptStringAsync).not.toHaveBeenCalled();
      expect(existsSync(join(dir, 'key.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the smoke-only keychain failure flag before touching async safeStorage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem2-safe-storage-'));
    const saved = process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL;
    const isAsyncEncryptionAvailable = vi.fn(async () => true);
    const encryptStringAsync = vi.fn(async () => Buffer.from('should-not-be-called'));
    const w = buildSafeStorageWrapper(fakeSafeStorage({
      isAsyncEncryptionAvailable,
      encryptStringAsync,
    }), 'darwin');

    process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL = 'keychain';
    try {
      await expect(loadOrCreateCipher({ dir, wrapper: w })).rejects.toThrow(/forced keychain unavailable/i);
      expect(isAsyncEncryptionAvailable).not.toHaveBeenCalled();
      expect(encryptStringAsync).not.toHaveBeenCalled();
      expect(existsSync(join(dir, 'key.json'))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL;
      else process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not overwrite an encrypted corpus when async unwrap fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem2-safe-storage-'));
    const c1 = await loadOrCreateCipher({ dir, wrapper: buildSafeStorageWrapper(fakeSafeStorage(), 'darwin') });
    const ciphertext = c1.encrypt('remembered', 'aad');
    const w = buildSafeStorageWrapper(fakeSafeStorage({
      decryptStringAsync: async () => { throw new Error('Keychain Not Found'); },
    }), 'darwin');

    try {
      await expect(loadOrCreateCipher({ dir, wrapper: w })).rejects.toThrow(/memory store is locked|Keychain Not Found/i);
      expect(c1.decrypt(ciphertext, 'aad')).toBe('remembered');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects insecure Linux backends (basic_text / unknown) before async keyring access', async () => {
    const basicAvailability = vi.fn(async () => true);
    const unknownAvailability = vi.fn(async () => true);
    const libsecretAvailability = vi.fn(async () => true);
    const basic = buildSafeStorageWrapper(fakeSafeStorage({
      isAsyncEncryptionAvailable: basicAvailability,
      getSelectedStorageBackend: () => 'basic_text',
    }), 'linux');
    const unknown = buildSafeStorageWrapper(fakeSafeStorage({
      isAsyncEncryptionAvailable: unknownAvailability,
      getSelectedStorageBackend: () => 'unknown',
    }), 'linux');
    const libsecret = buildSafeStorageWrapper(fakeSafeStorage({
      isAsyncEncryptionAvailable: libsecretAvailability,
      getSelectedStorageBackend: () => 'gnome_libsecret',
    }), 'linux');
    await expect(basic.available()).resolves.toBe(false);
    await expect(unknown.available()).resolves.toBe(false);
    await expect(libsecret.available()).resolves.toBe(true);
    expect(basicAvailability).not.toHaveBeenCalled();
    expect(unknownAvailability).not.toHaveBeenCalled();
    expect(libsecretAvailability).toHaveBeenCalledTimes(1);
  });

  it('reports the selected backend in describe()', () => {
    const linux = buildSafeStorageWrapper(fakeSafeStorage({
      getSelectedStorageBackend: () => 'gnome_libsecret',
    }), 'linux');
    const forced = buildSafeStorageWrapper(fakeSafeStorage(), 'darwin');
    const saved = process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL;

    process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL = 'keychain';
    try {
      expect(linux.describe()).toBe('safeStorage(linux/gnome_libsecret; forced keychain unavailable)');
      expect(forced.describe()).toBe('safeStorage(darwin/os-keychain; forced keychain unavailable)');
    } finally {
      if (saved === undefined) delete process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL;
      else process.env.RORO_MEMORY_HEALTH_SMOKE_FAIL = saved;
    }
  });
});
