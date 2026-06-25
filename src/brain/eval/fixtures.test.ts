import { describe, it, expect } from 'vitest';
import { DECIDE_CASES, EXTRACT_CASES, BEHAVIORAL_EXTRACT_CASES } from './fixtures';
import { FACT_SYSTEM_PROMPT, isPlausiblePreference } from '../extractFact';

const COMMANDS = ['run_agent', 'answer', 'capture_screen', 'clarify'];

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
function ngrams(s: string, n: number): string[] {
  const w = words(s);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
}

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

  it('behavioral value-quality cases: unique ids, all facts WITH a non-empty valueContract', () => {
    const ids = BEHAVIORAL_EXTRACT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BEHAVIORAL_EXTRACT_CASES.length).toBeGreaterThanOrEqual(5);
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      expect(c.expect, c.id).toBe('fact');
      expect((c.valueContract?.mustContainOneOf?.length ?? 0) > 0, `${c.id} missing valueContract.mustContainOneOf`).toBe(true);
    }
  });

  it('behavioral cases all pass the marker gate (so a miss measures VALUE quality, not a gate reason)', () => {
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      expect(isPlausiblePreference(c.input), `${c.id} lacks a PREFERENCE_MARKER → would be gated out, not scored`).toBe(true);
    }
  });

  it('ANTI-MEMORIZATION: behavioral ≠ detection, and NO fact fixture (either set) shares a 4-gram with the prompt', () => {
    const extractTranscripts = new Set(EXTRACT_CASES.map((c) => c.input.transcript));
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      expect(extractTranscripts.has(c.input.transcript), `${c.id} duplicates an EXTRACT_CASES transcript`).toBe(false);
    }
    // No distinctive 4-word phrase of ANY fact-expecting fixture (behavioral OR detection) may appear in the
    // prompt — that would let the model parrot the answer instead of generalizing. Covers both sets so a
    // future prompt example can't silently collide with either.
    const promptWords = words(FACT_SYSTEM_PROMPT).join(' ');
    const factFixtures = [...BEHAVIORAL_EXTRACT_CASES, ...EXTRACT_CASES.filter((c) => c.expect === 'fact')];
    for (const c of factFixtures) {
      for (const g of ngrams(c.input.transcript, 4)) {
        expect(promptWords.includes(g), `${c.id} shares phrase "${g}" with FACT_SYSTEM_PROMPT (memorization risk)`).toBe(false);
      }
    }
  });
});
