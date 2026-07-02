// src/memory2/keyManager.ts — envelope key management for memory2 encrypt-at-rest.
//
// One random 32-byte DATA KEY (DEK) per store encrypts every entry's content (cipher.ts). The DEK is
// itself WRAPPED by the OS keychain (Electron safeStorage — the KeyWrapper seam) and persisted as
// <dir>/key.json. Envelope encryption means an OS-keychain rotation only rewraps the small DEK; the
// corpus is never re-encrypted. The wrapper is a seam so this is unit-testable without Electron; the
// production safeStorage adapter is wired in index.ts.
//
// FAIL LOUD: if the keychain is unavailable, or a persisted DEK can no longer be unwrapped (the OS key
// changed), we throw — never silently downgrade to plaintext, never wipe + reinitialize (that would
// orphan the user's encrypted corpus). The files are the source of truth; a lost key is a real incident.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createAesGcmCipher, type Cipher } from './cipher';

/** The OS-keychain seam. Production = Electron safeStorage (index.ts); tests = a reversible fake. */
export interface KeyWrapper {
  /** True only when a real OS keychain backend is selected (not a plaintext/unknown fallback). */
  available(): Promise<boolean>;
  /** Wrap the raw DEK with the OS key -> an opaque token safe to persist. */
  wrap(plaintext: Buffer): Promise<string>;
  /** Recover the raw DEK; throws if the OS key changed / token is corrupt. */
  unwrap(token: string): Promise<Buffer>;
  /** Human-readable backend description (for error messages). */
  describe(): string;
}

const KEY_FILE = 'key.json';
const KEY_VERSION = 1;
const DEK_BYTES = 32;

interface KeyFile {
  version: number;
  wrappedDek: string;
}

/** Load the per-store DEK (creating + persisting it on first run), return a Cipher bound to it. */
export async function loadOrCreateCipher(opts: { dir: string; wrapper: KeyWrapper }): Promise<Cipher> {
  const { dir, wrapper } = opts;
  if (!(await wrapper.available())) {
    throw new Error(
      `memory2: OS keychain unavailable (${wrapper.describe()}) — cannot encrypt memory at rest, and ` +
        `encrypt-by-default will not silently store plaintext. Run on a system with a real keychain backend.`,
    );
  }
  await mkdir(dir, { recursive: true });
  const keyPath = join(dir, KEY_FILE);

  const existing = await readFile(keyPath, 'utf8').catch(() => null);
  if (existing !== null) {
    let parsed: KeyFile;
    try {
      parsed = JSON.parse(existing) as KeyFile;
    } catch {
      throw new Error(`memory2: ${KEY_FILE} is corrupt (invalid JSON) — refusing to overwrite the key for an encrypted store.`);
    }
    let dek: Buffer;
    try {
      dek = await wrapper.unwrap(parsed.wrappedDek);
    } catch (err) {
      // The OS key changed (or the wrapped DEK is corrupt): the corpus is unrecoverable with this key.
      // Fail loud — do NOT reinitialize, which would orphan every encrypted entry.
      throw new Error(
        `memory2: the memory store is locked — its data key is unrecoverable with the current OS keychain ` +
          `(${wrapper.describe()}): ${(err as Error).message}. The encrypted corpus cannot be read.`,
      );
    }
    if (dek.length !== DEK_BYTES) {
      throw new Error(`memory2: recovered data key has length ${dek.length}, expected ${DEK_BYTES} — refusing to proceed.`);
    }
    return createAesGcmCipher(dek);
  }

  // First run: mint a DEK, wrap it, persist durably (tmp -> rename), return the cipher.
  const dek = randomBytes(DEK_BYTES);
  const file: KeyFile = { version: KEY_VERSION, wrappedDek: await wrapper.wrap(dek) };
  const tmp = `${keyPath}.tmp`;
  await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
  await rename(tmp, keyPath);
  return createAesGcmCipher(dek);
}
