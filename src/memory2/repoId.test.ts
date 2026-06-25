import { describe, it, expect } from 'vitest';
import { repoId } from './repoId';

// repoId gives a memory a STABLE, deterministic project scope: the same repo path always yields the same id
// across turns/sessions, so recall can boost (or later filter) by the project a memory belongs to.

describe('repoId', () => {
  it('is deterministic — the same path always yields the same id', () => {
    expect(repoId('/Users/jin/code/roro')).toBe(repoId('/Users/jin/code/roro'));
  });

  it('distinguishes different repos', () => {
    expect(repoId('/Users/jin/code/roro')).not.toBe(repoId('/Users/jin/code/other'));
  });

  it('normalizes trailing path separators (path and path/ are the same repo)', () => {
    expect(repoId('/Users/jin/code/roro/')).toBe(repoId('/Users/jin/code/roro'));
    expect(repoId('/Users/jin/code/roro///')).toBe(repoId('/Users/jin/code/roro'));
  });

  it('returns "" for an absent/blank repo (no project scope)', () => {
    expect(repoId('')).toBe('');
    expect(repoId('   ')).toBe('');
  });

  it('is a short, fixed-length, opaque hex id (not the raw path)', () => {
    const id = repoId('/Users/jin/code/roro');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain('/');
  });
});
