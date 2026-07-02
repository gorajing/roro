import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createAesGcmCipher, sealEntry, openEntry, entryAad, ENCRYPTION_VERSION } from './cipher';
import type { Entry } from './types';

const key = randomBytes(32);
const cipher = createAesGcmCipher(key);
const AAD = 'structural-aad';

const e = (over: Partial<Entry> = {}): Entry => ({
  id: 'x', schemaVersion: 1, tier: 'episode', ownerId: 'o1', text: 'secret memory text',
  createdAt: '2026-06-22T00:00:00.000Z', seq: 1, ...over,
});

describe('cipher — AES-256-GCM (AAD-bound) + keyed fingerprint + Entry seal/open', () => {
  it('round-trips a string under matching AAD, leaking no plaintext', () => {
    const ct = cipher.encrypt('the cat prefers Neovim', AAD);
    expect(ct).not.toContain('Neovim');
    expect(cipher.decrypt(ct, AAD)).toBe('the cat prefers Neovim');
  });

  it('fails loud when the AAD does not match (metadata tamper)', () => {
    const ct = cipher.encrypt('bound', AAD);
    expect(() => cipher.decrypt(ct, 'different-aad')).toThrow();
  });

  it('uses a fresh IV per call (same plaintext+aad -> different ciphertext)', () => {
    expect(cipher.encrypt('same', AAD)).not.toBe(cipher.encrypt('same', AAD));
  });

  it('requires a 32-byte key', () => {
    expect(() => createAesGcmCipher(randomBytes(16))).toThrow(/32-byte/);
  });

  it('fails loud on a tampered ciphertext (GCM auth tag)', () => {
    const ct = Buffer.from(cipher.encrypt('authentic', AAD), 'base64');
    ct[ct.length - 1] ^= 0xff;
    expect(() => cipher.decrypt(ct.toString('base64'), AAD)).toThrow();
  });

  it('fingerprint is deterministic, keyed, and not the plaintext', () => {
    expect(cipher.fingerprint('uses pnpm')).toBe(cipher.fingerprint('uses pnpm')); // stable
    expect(cipher.fingerprint('uses pnpm')).not.toContain('pnpm');
    const other = createAesGcmCipher(randomBytes(32));
    expect(other.fingerprint('uses pnpm')).not.toBe(cipher.fingerprint('uses pnpm')); // keyed (not guessable)
  });

  it('seals an entry: text + payload become ciphertext, structural fields untouched', () => {
    const sealed = sealEntry(e({ text: 'remember this', payload: { key: 'editor', value: 'Neovim' } }), cipher);
    expect(sealed.encryptionVersion).toBe(ENCRYPTION_VERSION);
    expect(sealed.text).not.toContain('remember this');
    expect(typeof sealed.payload).toBe('string');
    expect(JSON.stringify(sealed.payload)).not.toContain('Neovim');
    expect(sealed.id).toBe('x');
    expect(sealed.ownerId).toBe('o1');
    expect(sealed.tier).toBe('episode');
    expect(sealed.seq).toBe(1);
  });

  it('open(seal(entry)) restores text + payload', () => {
    const original = e({ text: 'restore me', payload: { key: 'lang', value: 'TypeScript' } });
    const opened = openEntry(sealEntry(original, cipher), cipher);
    expect(opened.text).toBe('restore me');
    expect(opened.payload).toEqual({ key: 'lang', value: 'TypeScript' });
    expect(opened.encryptionVersion).toBeUndefined();
  });

  it('binds structural identity as AAD — tampering a sealed entry field fails the open', () => {
    const sealed = sealEntry(e({ ownerId: 'o1' }), cipher);
    const reowned = { ...sealed, ownerId: 'attacker' }; // flip the plaintext owner on the sealed row
    expect(() => openEntry(reowned, cipher)).toThrow();
  });

  it('seal is idempotent for the current version; throws on an unknown version', () => {
    const once = sealEntry(e(), cipher);
    expect(sealEntry(once, cipher).text).toBe(once.text); // no double-encrypt
    expect(() => sealEntry({ ...e(), encryptionVersion: 99 }, cipher)).toThrow(/unknown encryptionVersion/);
  });

  it('open is a no-op on plaintext; throws on an unknown version', () => {
    const plain = e({ text: 'never encrypted' });
    expect(openEntry(plain, cipher)).toEqual(plain);
    expect(() => openEntry({ ...e(), encryptionVersion: 99, text: 'x' }, cipher)).toThrow(/unknown encryptionVersion/);
  });

  it('handles an undefined payload', () => {
    const sealed = sealEntry(e({ payload: undefined }), cipher);
    expect(sealed.payload).toBeUndefined();
    expect(openEntry(sealed, cipher).payload).toBeUndefined();
  });

  it('entryAad changes when any bound structural field changes', () => {
    expect(entryAad(e({ seq: 1 }))).not.toBe(entryAad(e({ seq: 2 })));
    expect(entryAad(e({ ownerId: 'a' }))).not.toBe(entryAad(e({ ownerId: 'b' })));
  });
});
