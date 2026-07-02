// src/memory2/encryptionMode.ts — the all-or-nothing encryption mode marker, at the FILES-AS-TRUTH layer.
//
// Encrypt-at-rest is a STORE property, not an index property: opening a plaintext store with a cipher (or
// an encrypted store without one) would mix sealed + plaintext rows / read ciphertext as text. The marker
// lives in the STORE ROOT (not idx_meta), so it survives an index rebuild/deletion — closing the
// deleted-index false-negative the derived-index marker had. (dim + embed_model stay in idx_meta: those
// ARE index properties.) Fail loud on a mismatch; the files are the source of truth.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const MARKER_FILE = 'encryption.json';

/** Assert (and on first use, persist) the store's encryption mode. Throws on a mismatch. */
export async function assertEncryptionMode(dir: string, encrypted: boolean): Promise<void> {
  await mkdir(dir, { recursive: true });
  const markerPath = join(dir, MARKER_FILE);
  const mode = encrypted ? 'v1' : 'none';

  // ONLY a genuine absence (ENOENT) means "first use, stamp it" — any other read error (EACCES, EIO, …)
  // means the mode is UNKNOWN, so fail loud rather than silently stamping the current cipher's mode.
  const existing = await readFile(markerPath, 'utf8').catch((err: unknown) => {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw new Error(`memory2: cannot read ${MARKER_FILE} (${(err as Error).message}) — refusing to open with an unknown encryption mode.`);
  });
  if (existing !== null) {
    let parsed: { version?: unknown; mode?: unknown };
    try {
      parsed = JSON.parse(existing) as { version?: unknown; mode?: unknown };
    } catch {
      throw new Error(`memory2: ${MARKER_FILE} is corrupt (invalid JSON) — refusing to open with an unknown encryption mode.`);
    }
    // Strict schema: a malformed-but-valid-JSON marker ({} , {mode:''}, …) must NOT silently pass the guard.
    if (parsed.version !== 1 || (parsed.mode !== 'v1' && parsed.mode !== 'none')) {
      throw new Error(`memory2: ${MARKER_FILE} is malformed (bad version/mode) — refusing to open with an unknown encryption mode.`);
    }
    if (parsed.mode !== mode) {
      throw new Error(
        `memory2: this store was created ${parsed.mode === 'none' ? 'WITHOUT encryption' : `with encryption ${parsed.mode}`} but ` +
          `${encrypted ? 'a cipher is configured' : 'no cipher is configured'} — encryption is all-or-nothing per store. ` +
          `Open it in its original mode, or move/rebuild the dir to switch.`,
      );
    }
    return;
  }

  // First use: stamp the mode durably (tmp -> rename), so an index rebuild/deletion can't lose it.
  const tmp = `${markerPath}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, mode }), { mode: 0o600 });
  await rename(tmp, markerPath);
}
