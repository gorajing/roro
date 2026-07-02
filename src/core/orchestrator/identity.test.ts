import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOwnerFile, loadOrMintOwnerId, OwnerCorruptError } from './identity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('parseOwnerFile', () => {
  it('accepts a well-formed owner file', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseOwnerFile(JSON.stringify({ owner_id: id }))).toEqual({ ok: true, id });
  });
  it('rejects garbage / missing id', () => {
    expect(parseOwnerFile('not json')).toEqual({ ok: false });
    expect(parseOwnerFile(JSON.stringify({ owner_id: 'nope' }))).toEqual({ ok: false });
    expect(parseOwnerFile(JSON.stringify({}))).toEqual({ ok: false });
  });
});

describe('loadOrMintOwnerId', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'roro-owner-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('mints a v4 uuid and writes it when no file exists', async () => {
    const { id, minted } = await loadOrMintOwnerId(dir);
    expect(minted).toBe(true);
    expect(id).toMatch(UUID_RE);
    const onDisk = JSON.parse(await readFile(join(dir, 'owner.json'), 'utf8'));
    expect(onDisk.owner_id).toBe(id);
  });

  it('returns the SAME id on a second load (stability across launches)', async () => {
    const first = await loadOrMintOwnerId(dir);
    const second = await loadOrMintOwnerId(dir);
    expect(second.minted).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('writes atomically (no leftover .tmp file)', async () => {
    await loadOrMintOwnerId(dir);
    const files = await readdir(dir);
    expect(files).toEqual(['owner.json']);
  });

  it('throws OwnerCorruptError on a garbled file — never silently re-mints', async () => {
    await writeFile(join(dir, 'owner.json'), '{ corrupt');
    await expect(loadOrMintOwnerId(dir)).rejects.toBeInstanceOf(OwnerCorruptError);
  });
});
