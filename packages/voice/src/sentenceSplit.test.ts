import { describe, it, expect } from 'vitest';
import { splitSentences } from './sentenceSplit';

// Kokoro has no usable license-clean streaming, so we sentence-chunk: synthesize + play sentence 1 while
// sentence 2 synthesizes (the cat starts talking fast). A chunk must also stay well under Kokoro's ~509
// phoneme-token ceiling, so an over-long sentence is sub-split on clause punctuation.

describe('splitSentences — chunk assistant text for streamed synthesis', () => {
  it('splits on sentence boundaries, keeping terminal punctuation', () => {
    expect(splitSentences('Hello world. How are you?')).toEqual(['Hello world.', 'How are you?']);
  });

  it('returns a single chunk for one sentence (incl. no terminal punctuation)', () => {
    expect(splitSentences('just one line')).toEqual(['just one line']);
  });

  it('trims whitespace and drops empty chunks', () => {
    expect(splitSentences('  A.   B!  ')).toEqual(['A.', 'B!']);
  });

  it('returns [] for empty/whitespace-only input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
  });

  it('sub-splits an over-long clause-laden sentence so no chunk exceeds the cap', () => {
    const long = 'one part, ' + 'two part, '.repeat(60) + 'final part'; // ~600+ chars, no sentence ender
    const out = splitSentences(long);
    expect(out.length).toBeGreaterThan(1); // it was broken up
    for (const c of out) expect(c.length).toBeLessThanOrEqual(300); // each under the cap
    expect(out.join(' ').replace(/\s+/g, ' ')).toContain('final part'); // nothing lost
  });
});
