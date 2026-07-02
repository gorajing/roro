// src/memory2/cipher.ts — the encrypt-at-rest seam (content encryption for memory2).
//
// "Encrypt by default in v1" (the privacy moat). The Cipher wraps a per-store DATA KEY (DEK); the DEK is
// itself wrapped by the OS keychain (Electron safeStorage) in keyManager.ts — envelope encryption, so a
// keychain-key rotation rewraps the DEK without re-encrypting the corpus. We encrypt ONLY the directly-
// readable content (entry.text + payload). Structural fields (id/ownerId/seq/tier/factKey/timestamps/
// embed*) stay plaintext because the index filters/orders/reconciles on them — but they are BOUND as
// AES-GCM AAD, so tampering with the plaintext metadata fails the auth tag. The embedding VECTOR stays
// plaintext (KNN needs it; recomputing the whole corpus per launch is prohibitive) — embedding-inversion
// is a documented v1 residual. contentHash is a KEYED HMAC over plaintext (encryption-invariant + not
// guessable for low-entropy facts), not a public SHA-256.

import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import type { Entry } from './types';

export interface Cipher {
  /** Encrypt UTF-8 plaintext -> opaque token, binding `aad` (additional authenticated data) into the tag. */
  encrypt(plaintext: string, aad: string): string;
  /** Decrypt a token from encrypt(); throws (fail loud) on tamper, wrong key, or AAD mismatch. */
  decrypt(token: string, aad: string): string;
  /** Keyed content fingerprint (HMAC) over canonical plaintext — stable per store, not publicly guessable. */
  fingerprint(canonical: string): string;
}

export const ENCRYPTION_VERSION = 1;

const ALG = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard nonce
const TAG_LEN = 16;

/** AES-256-GCM cipher over a 32-byte DEK. Token layout: base64(iv ‖ tag ‖ ciphertext). */
export function createAesGcmCipher(key: Buffer): Cipher {
  if (key.length !== 32) throw new Error('createAesGcmCipher requires a 32-byte key (aes-256-gcm)');
  return {
    encrypt(plaintext: string, aad: string): string {
      const iv = randomBytes(IV_LEN);
      const c = createCipheriv(ALG, key, iv);
      c.setAAD(Buffer.from(aad, 'utf8'));
      const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    },
    decrypt(token: string, aad: string): string {
      const buf = Buffer.from(token, 'base64');
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const enc = buf.subarray(IV_LEN + TAG_LEN);
      const d = createDecipheriv(ALG, key, iv);
      d.setAAD(Buffer.from(aad, 'utf8'));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    },
    fingerprint(canonical: string): string {
      return createHmac('sha256', key).update(canonical).digest('hex');
    },
  };
}

/** AAD bound to every content ciphertext: the plaintext structural identity. Tampering with any of these
 *  fields (e.g. re-owning a row, changing its tier/key/order) breaks decryption. seq is included, so seal
 *  must run AFTER the writer assigns it. */
export function entryAad(entry: Entry): string {
  return JSON.stringify([
    entry.id, entry.ownerId, entry.tier, entry.seq ?? null, entry.factKey ?? null, entry.createdAt, entry.schemaVersion ?? null,
  ]);
}

/** Encrypt the content fields for at-rest storage. Idempotent for the CURRENT version; fails loud on an
 *  unknown version (never silently no-op a row this build can't interpret). */
export function sealEntry(entry: Entry, cipher: Cipher): Entry {
  if (entry.encryptionVersion === ENCRYPTION_VERSION) return entry;
  if (entry.encryptionVersion !== undefined) {
    throw new Error(`cipher: cannot seal an entry with unknown encryptionVersion ${entry.encryptionVersion}`);
  }
  const aad = entryAad(entry);
  return {
    ...entry,
    text: cipher.encrypt(entry.text, aad),
    payload: entry.payload === undefined ? entry.payload : cipher.encrypt(JSON.stringify(entry.payload), aad),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

/** Decrypt the content fields after a read. No-op on a plaintext entry; fails loud on an unknown version. */
export function openEntry(entry: Entry, cipher: Cipher): Entry {
  if (entry.encryptionVersion === undefined) return entry;
  if (entry.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(`cipher: cannot open an entry with unknown encryptionVersion ${entry.encryptionVersion}`);
  }
  const aad = entryAad(entry);
  return {
    ...entry,
    text: cipher.decrypt(entry.text, aad),
    payload: entry.payload === undefined ? entry.payload : JSON.parse(cipher.decrypt(entry.payload as string, aad)),
    encryptionVersion: undefined,
  };
}
