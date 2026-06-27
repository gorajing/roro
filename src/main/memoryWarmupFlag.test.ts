import { describe, expect, it } from 'vitest';
import { memoryWarmupDisabled } from './memoryWarmupFlag';

describe('memoryWarmupDisabled', () => {
  it('keeps startup memory warmup on by default', () => {
    expect(memoryWarmupDisabled({})).toBe(false);
    expect(memoryWarmupDisabled({ RORO_DISABLE_MEMORY_WARMUP: '0' })).toBe(false);
  });

  it('allows rendered UI smokes to skip real memory/keychain startup warmup explicitly', () => {
    expect(memoryWarmupDisabled({ RORO_DISABLE_MEMORY_WARMUP: '1' })).toBe(true);
  });
});
