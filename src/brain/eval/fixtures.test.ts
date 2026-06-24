import { describe, it, expect } from 'vitest';
import { DECIDE_CASES, EXTRACT_CASES } from './fixtures';

const COMMANDS = ['run_agent', 'answer', 'capture_screen', 'clarify'];

// The golden set is only as good as its hygiene — a typo'd expected command or a duplicate id silently
// poisons the metric. This runs in CI (no model) to keep the fixtures well-formed and from shrinking.

describe('brain eval fixtures — well-formed golden set', () => {
  it('decide cases: unique ids, valid expected command, non-empty transcript, covers all 4 commands', () => {
    const ids = DECIDE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DECIDE_CASES) {
      expect(COMMANDS, `${c.id} expects an unknown command`).toContain(c.expect);
      expect(c.input.transcript.trim().length, `${c.id} has empty transcript`).toBeGreaterThan(0);
    }
    expect(new Set(DECIDE_CASES.map((c) => c.expect))).toEqual(new Set(COMMANDS)); // every command exercised
    expect(DECIDE_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('extract cases: unique ids, valid expectation, both fact and null exercised', () => {
    const ids = EXTRACT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of EXTRACT_CASES) {
      expect(['fact', 'null'], `${c.id} has an invalid expectation`).toContain(c.expect);
      expect(c.input.transcript.trim().length, `${c.id} has empty transcript`).toBeGreaterThan(0);
    }
    const kinds = new Set(EXTRACT_CASES.map((c) => c.expect));
    expect(kinds.has('fact') && kinds.has('null')).toBe(true);
    expect(EXTRACT_CASES.length).toBeGreaterThanOrEqual(8);
  });
});
