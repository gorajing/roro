// src/memory2/safeStorageWrapper.ts — the production KeyWrapper over Electron safeStorage.
//
// safeStorage wraps the per-store DEK with the OS keychain (Keychain on macOS, DPAPI on Windows,
// libsecret/kwallet on Linux). This builder takes the safeStorage object as a parameter (no static
// electron import) so it stays unit-testable; index.ts dynamically imports electron and passes it in.
//
// "Available" is strict: on Linux a `basic_text`/`unknown` backend is NOT a real keychain (it stores the
// key obfuscated-but-recoverable), so we reject it — encrypt-by-default must not lean on a fake vault.

import type { KeyWrapper } from './keyManager';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const INSECURE_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);

export function buildSafeStorageWrapper(ss: SafeStorageLike, platform: string): KeyWrapper {
  const backend = (): string =>
    platform === 'linux' && ss.getSelectedStorageBackend ? ss.getSelectedStorageBackend() : 'os-keychain';
  return {
    available(): boolean {
      if (!ss.isEncryptionAvailable()) return false;
      if (platform === 'linux' && INSECURE_LINUX_BACKENDS.has(backend())) return false;
      return true;
    },
    describe: () => `safeStorage(${platform}/${backend()})`,
    // The DEK is binary; safeStorage works on strings, so wrap/unwrap go through base64.
    wrap: (plaintext: Buffer): string => ss.encryptString(plaintext.toString('base64')).toString('base64'),
    unwrap: (token: string): Buffer => Buffer.from(ss.decryptString(Buffer.from(token, 'base64')), 'base64'),
  };
}
