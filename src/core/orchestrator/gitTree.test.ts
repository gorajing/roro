import { describe, it, expect } from 'vitest';
import { isCleanTree } from './gitTree';

describe('isCleanTree', () => {
  it('clean when `git status --porcelain` is empty', async () => {
    expect(await isCleanTree('/repo', async () => '')).toBe(true);
    expect(await isCleanTree('/repo', async () => '   \n')).toBe(true);
  });

  it('NOT clean when there are changes', async () => {
    expect(await isCleanTree('/repo', async () => ' M src/app.ts\n?? new.ts\n')).toBe(false);
  });

  it('treats an error as NOT clean (deny the destructive run when undeterminable)', async () => {
    expect(await isCleanTree('/repo', async () => { throw new Error('not a git repo'); })).toBe(false);
  });
});
