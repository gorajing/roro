import { describe, expect, it } from 'vitest';
import { createPendingQueue } from './pendingQueue';

const item = (key: string) => ({ sessionId: 's1', agent: 'codex' as const, key, value: `${key} value words`, evidence: `${key} evidence text` });

describe('pendingQueue — MAIN in-memory, cap 6, TTL 24h, evaporates on quit by construction', () => {
  it('adds and lists proposals with minted ids', () => {
    const q = createPendingQueue();
    const added = q.add([item('a'), item('b')]);
    expect(added).toHaveLength(2);
    expect(new Set(added.map((p) => p.id)).size).toBe(2);
    expect(q.list().map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('evicts the OLDEST beyond the cap of 6', () => {
    const q = createPendingQueue();
    q.add([1, 2, 3, 4, 5, 6, 7].map((n) => item(`k${n}`)));
    const keys = q.list().map((p) => p.key);
    expect(keys).toHaveLength(6);
    expect(keys).not.toContain('k1');
    expect(keys).toContain('k7');
  });

  it('lazily expires entries past the 24h TTL', () => {
    let t = 1_000;
    const q = createPendingQueue({ now: () => t });
    q.add([item('old')]);
    t += 24 * 60 * 60 * 1000 + 1;
    q.add([item('fresh')]);
    expect(q.list().map((p) => p.key)).toEqual(['fresh']);
  });

  it('take() resolves a proposal exactly once (idempotent gone-state afterward)', () => {
    const q = createPendingQueue();
    const [p] = q.add([item('a')]);
    expect(q.take(p.id)?.key).toBe('a');
    expect(q.take(p.id)).toBeNull();
    expect(q.list()).toEqual([]);
  });

  it('take() of an unknown id is a typed no-op, never a throw', () => {
    const q = createPendingQueue();
    expect(q.take('nope')).toBeNull();
  });

  it('clear() empties the queue (quit path)', () => {
    const q = createPendingQueue();
    q.add([item('a')]);
    q.clear();
    expect(q.list()).toEqual([]);
  });
});
