// src/memory2/safeStorageWrapper.ts — the production KeyWrapper over Electron safeStorage.
//
// safeStorage wraps the per-store DEK with the OS keychain (Keychain on macOS, DPAPI on Windows,
// libsecret/kwallet on Linux). This builder takes the safeStorage object as a parameter (no static
// electron import) so it stays unit-testable; index.ts dynamically imports electron and passes it in.
//
// "Available" is strict: on Linux a `basic_text`/`unknown` backend is NOT a real keychain (it stores the
// key obfuscated-but-recoverable), so we reject it — encrypt-by-default must not lean on a fake vault.

import type { KeyWrapper } from './keyManager';
import { guardDeferredEnv } from '../shared/releaseChannel';

export interface SafeStorageLike {
  isEncryptionAvailable?(): boolean;
  encryptString?(plainText: string): Buffer;
  decryptString?(encrypted: Buffer): string;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
  getSelectedStorageBackend?(): string;
}

const INSECURE_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);
declare const process: { env: Record<string, string | undefined> };

export function buildSafeStorageWrapper(ss: SafeStorageLike, platform: string): KeyWrapper {
  const backend = (): string =>
    platform === 'linux' && ss.getSelectedStorageBackend ? ss.getSelectedStorageBackend() : 'os-keychain';
  // Guarded: the keychain-failure smoke flag is a deferred-v0 harness — a release/cohort build refuses it.
  const forcedKeychainFailure = (): boolean =>
    guardDeferredEnv(process.env).RORO_MEMORY_HEALTH_SMOKE_FAIL === 'keychain';
  return {
    async available(): Promise<boolean> {
      if (forcedKeychainFailure()) return false;
      if (platform === 'linux' && INSECURE_LINUX_BACKENDS.has(backend())) return false;
      return ss.isAsyncEncryptionAvailable();
    },
    describe: () => `safeStorage(${platform}/${backend()}${forcedKeychainFailure() ? '; forced keychain unavailable' : ''})`,
    // The DEK is binary; safeStorage works on strings, so wrap/unwrap go through base64.
    wrap: async (plaintext: Buffer): Promise<string> =>
      (await ss.encryptStringAsync(plaintext.toString('base64'))).toString('base64'),
    unwrap: async (token: string): Promise<Buffer> =>
      Buffer.from((await ss.decryptStringAsync(Buffer.from(token, 'base64'))).result, 'base64'),
  };
}
