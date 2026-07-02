// src/main/identity.ts — the device-stable owner_id (the un-retrofittable memory spine).
// MAIN-process only. The renderer never sees or supplies this; the orchestrator injects it.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Thrown when owner.json exists but is unreadable/garbled — we refuse to silently re-mint. */
export class OwnerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerCorruptError';
  }
}

export function parseOwnerFile(contents: string): { ok: true; id: string } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false };
  }
  const id = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).owner_id : undefined;
  return typeof id === 'string' && UUID_RE.test(id) ? { ok: true, id } : { ok: false };
}

/**
 * Load owner.json from `dir`, or mint + atomically write a new v4 uuid if absent.
 * A PRESENT-but-garbled file throws OwnerCorruptError (the caller decides whether to re-mint) —
 * a silent re-mint would orphan all prior memory, the exact failure owner_id exists to prevent.
 */
export async function loadOrMintOwnerId(dir: string): Promise<{ id: string; minted: boolean }> {
  const path = join(dir, 'owner.json');
  let contents: string | null = null;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (contents !== null) {
    const parsed = parseOwnerFile(contents);
    if (parsed.ok) return { id: parsed.id, minted: false };
    throw new OwnerCorruptError(`owner.json at ${path} is present but unreadable`);
  }

  const id = randomUUID();
  await atomicWriteJson(path, { owner_id: id });
  return { id, minted: true };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path); // rename is atomic on the same filesystem
}

let cached: string | null = null;

/** Boot wrapper (call once in main.ts whenReady, passing app.getPath('userData')). Last-resort LOUD
 *  re-mint on corruption. */
export async function initOwnerId(dir: string): Promise<string> {
  try {
    const { id, minted } = await loadOrMintOwnerId(dir);
    if (minted) console.log('[identity] minted new owner_id');
    cached = id;
    return id;
  } catch (err) {
    if (err instanceof OwnerCorruptError) {
      console.error(
        '[identity] owner.json CORRUPT — re-minting as a last resort. PRIOR MEMORY WILL BE ORPHANED.',
        err.message,
      );
      const id = randomUUID();
      await atomicWriteJson(join(dir, 'owner.json'), { owner_id: id });
      cached = id;
      return id;
    }
    throw err;
  }
}

/** Sync accessor for the orchestrator. Throws if initOwnerId() has not run. */
export function getOwnerId(): string {
  if (!cached) throw new Error('[identity] getOwnerId() called before initOwnerId()');
  return cached;
}
