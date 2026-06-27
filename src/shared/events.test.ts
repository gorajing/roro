import { describe, expect, it } from 'vitest';
import { formatMemoryStatus, parseMemoryStatus } from './events';

describe('memory status event text', () => {
  it('round-trips the canonical memory beat counts', () => {
    const text = formatMemoryStatus({ factCount: 1, episodeCount: 2 });

    expect(text).toBe('Memory: 1 known fact, 2 related items');
    expect(parseMemoryStatus(text)).toEqual({ factCount: 1, episodeCount: 2 });
  });

  it('handles zero and plural counts', () => {
    const text = formatMemoryStatus({ factCount: 0, episodeCount: 0 });

    expect(text).toBe('Memory: 0 known facts, 0 related items');
    expect(parseMemoryStatus(text)).toEqual({ factCount: 0, episodeCount: 0 });
  });

  it('rejects non-canonical status text', () => {
    expect(parseMemoryStatus('Memory: 1 known thing, 2 related items')).toBeNull();
    expect(parseMemoryStatus('some other status')).toBeNull();
  });
});
