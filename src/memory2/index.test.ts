import { describe, it, expect } from 'vitest';
import { lazySingleton } from './index';

describe('lazySingleton — memoize success, retry after rejection', () => {
  it('caches a successful build and never rebuilds it', async () => {
    let calls = 0;
    const get = lazySingleton(async () => { calls++; return `built-${calls}`; });
    expect(await get()).toBe('built-1');
    expect(await get()).toBe('built-1'); // memoized
    expect(calls).toBe(1);
  });

  it('clears the cache on rejection so a later call retries (safeStorage not-ready -> ready)', async () => {
    let calls = 0;
    const get = lazySingleton(async () => {
      calls++;
      if (calls === 1) throw new Error('keychain not ready');
      return 'ok';
    });
    await expect(get()).rejects.toThrow('keychain not ready'); // first build fails
    expect(await get()).toBe('ok'); // retried, not the cached rejection
    expect(await get()).toBe('ok'); // now memoized
    expect(calls).toBe(2);
  });
});
