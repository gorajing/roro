import { describe, it, expect } from 'vitest';
import { DECIDE_CASES, EXTRACT_CASES, BEHAVIORAL_EXTRACT_CASES, type BehavioralTaxonomy } from './fixtures';
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

const TAXONOMIES: BehavioralTaxonomy[] = [
  'noun-preference', 'behavioral-habit', 'hard-negative', 'marker-less', 'multi-fact', 'boolean-collapse', 'supersede',
];
/** Taxonomies whose cases expect a fact (and therefore carry a valueContract for the value-quality axis). */
const FACT_TAXONOMIES = new Set<BehavioralTaxonomy>(['noun-preference', 'behavioral-habit', 'multi-fact', 'boolean-collapse', 'supersede']);

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

  it('behavioral cases: unique ids (across ALL extract sets), a known taxonomy, every taxonomy populated', () => {
    const ids = BEHAVIORAL_EXTRACT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const allIds = [...ids, ...EXTRACT_CASES.map((c) => c.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(BEHAVIORAL_EXTRACT_CASES.length).toBeGreaterThanOrEqual(45); // the 5→~50 expansion must not silently shrink
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      expect(TAXONOMIES, `${c.id} has an unknown taxonomy`).toContain(c.taxonomy);
      expect(c.input.transcript.trim().length, `${c.id} has empty transcript`).toBeGreaterThan(0);
    }
    for (const t of TAXONOMIES) {
      const count = BEHAVIORAL_EXTRACT_CASES.filter((c) => c.taxonomy === t).length;
      expect(count, `taxonomy '${t}' has too few cases`).toBeGreaterThanOrEqual(3);
    }
  });

  it("fact-taxonomy cases expect 'fact' and carry a non-empty valueContract; null-taxonomy cases expect 'null'", () => {
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      if (FACT_TAXONOMIES.has(c.taxonomy)) {
        expect(c.expect, `${c.id} (${c.taxonomy}) must expect 'fact'`).toBe('fact');
        expect((c.valueContract?.mustContainOneOf?.length ?? 0) > 0, `${c.id} missing valueContract.mustContainOneOf`).toBe(true);
      } else {
        expect(c.expect, `${c.id} (${c.taxonomy}) must expect 'null'`).toBe('null');
        expect(c.valueContract, `${c.id} (${c.taxonomy}) must not carry a valueContract`).toBeUndefined();
      }
    }
  });

  it('gate alignment: every case EXCEPT marker-less passes the marker gate; marker-less cases FAIL it', () => {
    // Fact cases + hard negatives must reach the model (a miss measures the MODEL, not a gate reason).
    // marker-less cases pin the gate's deliberate safe-direction miss: if the PREFERENCE_MARKERS list
    // grows to cover one, this fails loudly and the case must be re-labeled (probably to a fact taxonomy)
    // instead of the metric silently shifting.
    for (const c of BEHAVIORAL_EXTRACT_CASES) {
      if (c.taxonomy === 'marker-less') {
        expect(isPlausiblePreference(c.input), `${c.id} now PASSES the gate — re-label its taxonomy`).toBe(false);
      } else {
        expect(isPlausiblePreference(c.input), `${c.id} lacks a PREFERENCE_MARKER → would be gated out, not scored`).toBe(true);
      }
    }
  });

  it('ANTI-MEMORIZATION: no behavioral/fact fixture shares a 4-gram with the prompt', () => {
    // No distinctive 4-word phrase of ANY behavioral fixture (either expectation) or fact-expecting
    // detection fixture may appear in the prompt — that would let the model parrot the answer (fact OR
    // null) instead of generalizing. Covers both sets so a future prompt example can't silently collide.
    const promptWords = words(FACT_SYSTEM_PROMPT).join(' ');
    const checked = [...BEHAVIORAL_EXTRACT_CASES, ...EXTRACT_CASES.filter((c) => c.expect === 'fact')];
    for (const c of checked) {
      for (const g of ngrams(c.input.transcript, 4)) {
        expect(promptWords.includes(g), `${c.id} shares phrase "${g}" with FACT_SYSTEM_PROMPT (memorization risk)`).toBe(false);
      }
    }
  });

  it('NO NEAR-DUPLICATES: no two extract/behavioral fixtures share a transcript 4-gram', () => {
    // A near-duplicate pair double-counts one behavior and makes the accuracy number lie about coverage.
    // 4-gram disjointness across ALL extract-side fixtures (detection + behavioral) is the same bar the
    // prompt check uses — two cases may share a topic, never a distinctive phrase.
    const all = [...EXTRACT_CASES, ...BEHAVIORAL_EXTRACT_CASES];
    const seen = new Map<string, string>(); // 4-gram -> first case id that used it
    for (const c of all) {
      for (const g of new Set(ngrams(c.input.transcript, 4))) {
        const prior = seen.get(g);
        expect(prior === undefined || prior === c.id, `${c.id} shares phrase "${g}" with ${prior}`).toBe(true);
        seen.set(g, c.id);
      }
    }
  });
});
