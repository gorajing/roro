import { describe, it, expect } from 'vitest';
import { parseJsonlLines } from './jsonl';

describe('parseJsonlLines — integrity semantics', () => {
  it('parses clean JSONL', () => {
    expect(parseJsonlLines('{"a":1}\n{"a":2}\n', 'x')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('tolerates a single torn TRAILING line (crash mid-append)', () => {
    expect(parseJsonlLines('{"a":1}\n{"a":2}\n{"a":3 borked', 'x')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('ignores blank/whitespace lines', () => {
    expect(parseJsonlLines('{"a":1}\n\n  \n{"a":2}\n', 'x')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('FAILS LOUD on interior corruption (never silently drops committed history)', () => {
    expect(() => parseJsonlLines('{"a":1}\n{borked\n{"a":3}\n', 'manifest')).toThrow(/interior corruption/);
  });
});
