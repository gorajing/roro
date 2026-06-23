import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendOp, readManifest, nextSeq, manifestPath, type ManifestOp } from './manifest';

const op = (over: Partial<ManifestOp> = {}): ManifestOp => ({
  seq: 1, op: 'put', id: 'f1', tier: 'fact', ownerId: 'o1', contentHash: 'abc', ts: '2026-06-22T00:00:00.000Z', ...over,
});

describe('manifest — append-only durability journal + seq allocator', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2man-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('empty store: no ops, seq starts at 1', async () => {
    expect(await readManifest(dir)).toEqual([]);
    expect(await nextSeq(dir)).toBe(1);
  });

  it('append -> read preserves ordered ops', async () => {
    await appendOp(dir, op({ seq: 1, id: 'a' }));
    await appendOp(dir, op({ seq: 2, id: 'b', op: 'delete' }));
    const ops = await readManifest(dir);
    expect(ops.map((o) => [o.seq, o.op, o.id])).toEqual([[1, 'put', 'a'], [2, 'delete', 'b']]);
  });

  it('nextSeq is monotonic — max(seq)+1, surviving reopen', async () => {
    await appendOp(dir, op({ seq: 1 }));
    await appendOp(dir, op({ seq: 2 }));
    expect(await nextSeq(dir)).toBe(3);
  });

  it('tolerates a torn trailing line (crash mid-append)', async () => {
    await appendOp(dir, op({ seq: 1, id: 'a' }));
    appendFileSync(manifestPath(dir), '{"seq":2,"op":"pu'); // torn
    expect((await readManifest(dir)).map((o) => o.id)).toEqual(['a']);
    expect(await nextSeq(dir)).toBe(2); // torn op ignored; next is max-good+1
  });
});
