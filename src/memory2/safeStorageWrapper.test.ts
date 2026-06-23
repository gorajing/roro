import { describe, it, expect } from 'vitest';
import { buildSafeStorageWrapper, type SafeStorageLike } from './safeStorageWrapper';

// A fake safeStorage: encryptString/decryptString round-trip via a reversible transform (NOT real crypto
// — just enough to exercise the wrapper's base64 + backend logic).
function fakeSafeStorage(over: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
    ...over,
  };
}

describe('buildSafeStorageWrapper — production KeyWrapper over Electron safeStorage', () => {
  it('wraps + unwraps a DEK round-trip (binary safe via base64)', () => {
    const w = buildSafeStorageWrapper(fakeSafeStorage(), 'darwin');
    const dek = Buffer.from([0, 1, 2, 255, 128, 64]);
    expect(w.unwrap(w.wrap(dek))).toEqual(dek);
  });

  it('is available on macOS/Windows when encryption is available', () => {
    expect(buildSafeStorageWrapper(fakeSafeStorage(), 'darwin').available()).toBe(true);
    expect(buildSafeStorageWrapper(fakeSafeStorage(), 'win32').available()).toBe(true);
  });

  it('is unavailable when safeStorage reports no encryption', () => {
    const w = buildSafeStorageWrapper(fakeSafeStorage({ isEncryptionAvailable: () => false }), 'darwin');
    expect(w.available()).toBe(false);
  });

  it('rejects insecure Linux backends (basic_text / unknown) but accepts a real keyring', () => {
    const basic = buildSafeStorageWrapper(fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }), 'linux');
    const unknown = buildSafeStorageWrapper(fakeSafeStorage({ getSelectedStorageBackend: () => 'unknown' }), 'linux');
    const libsecret = buildSafeStorageWrapper(fakeSafeStorage({ getSelectedStorageBackend: () => 'gnome_libsecret' }), 'linux');
    expect(basic.available()).toBe(false);
    expect(unknown.available()).toBe(false);
    expect(libsecret.available()).toBe(true);
  });
});
