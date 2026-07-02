import { describe, it, expect } from 'vitest';
import { scoreDecision, scoreExtraction, summarize, scoreFactValue } from './score';

// The PURE scoring core of the brain eval (CI-runnable, no model). The live runner (runEval.ts) calls the
// real 3B brain over golden fixtures and classifies each result with these; this is where the math lives.

describe('scoreDecision — did the brain pick the right command?', () => {
  it('ok when the command matches the golden expectation', () => {
    expect(scoreDecision('run_agent', 'run_agent')).toBe('ok');
  });
  it('wrong_command when it picks a different valid command', () => {
    expect(scoreDecision('run_agent', 'answer')).toBe('wrong_command');
    expect(scoreDecision('capture_screen', 'run_agent')).toBe('wrong_command');
  });
});

describe('scoreExtraction — did the extractor honor the durable-fact / null-discipline contract?', () => {
  const fact = { key: 'package_manager', value: 'pnpm' };
  it('ok when a durable fact was expected and produced', () => {
    expect(scoreExtraction('fact', fact)).toBe('ok');
  });
  it('missed_fact when a durable fact was expected but null came back', () => {
    expect(scoreExtraction('fact', null)).toBe('missed_fact');
  });
  it('ok when null was expected and null came back (the conservative win)', () => {
    expect(scoreExtraction('null', null)).toBe('ok');
  });
  it('false_fact when null was expected but the model invented a fact', () => {
    expect(scoreExtraction('null', fact)).toBe('false_fact');
  });
});

describe('scoreFactValue — the descriptive-value-quality axis (behavioral preferences)', () => {
  const contract = { mustContainOneOf: ['test'], minWords: 2 };
  it('missed_fact when the model returned null (incl. a boolean the runtime guard pre-empted to null)', () => {
    expect(scoreFactValue(contract, null)).toBe('missed_fact');
  });
  it('ok for a descriptive, on-topic value (the fix target)', () => {
    expect(scoreFactValue(contract, { key: 'k', value: 'writes a test alongside each feature' })).toBe('ok');
  });
  it('too_thin when the value has fewer than minWords words (a bare "true" that slipped the guard lands here)', () => {
    expect(scoreFactValue({ mustContainOneOf: ['test'], minWords: 2 }, { key: 'k', value: 'true' })).toBe('too_thin');
    expect(scoreFactValue({ mustContainOneOf: ['test'], minWords: 3 }, { key: 'k', value: 'test' })).toBe('too_thin');
  });
  it('off_topic when no required token is present', () => {
    expect(scoreFactValue({ mustContainOneOf: ['lint'] }, { key: 'k', value: 'conventional commits' })).toBe('off_topic');
  });
  it('matches whole-word starts, not incidental substrings (the leniency fix)', () => {
    // 'test' must NOT be satisfied by 'latest'; 'review' must NOT be satisfied by 'preview'/'approve'
    expect(scoreFactValue({ mustContainOneOf: ['test'], minWords: 2 }, { key: 'k', value: 'the latest greatest build' })).toBe('off_topic');
    expect(scoreFactValue({ mustContainOneOf: ['review'], minWords: 2 }, { key: 'k', value: 'preview then approve' })).toBe('off_topic');
    // but inflections DO match: 'lint' matches 'linter', 'test' matches 'tests'
    expect(scoreFactValue({ mustContainOneOf: ['lint'], minWords: 2 }, { key: 'k', value: 'runs the linter first' })).toBe('ok');
    expect(scoreFactValue({ mustContainOneOf: ['test'], minWords: 2 }, { key: 'k', value: 'writes tests early' })).toBe('ok');
  });
});

describe('scoreFactValue — the polarity guards (an inverted memory is worse than a missed one)', () => {
  // The four contracts below mirror the guarded fixtures (fixtures.ts); each inverted value here was
  // confirmed to score 'ok' before the guards existed — the exact gap this closes.
  const forcePush = { mustContainOneOf: ['force', 'push'], mustAlsoContainOneOf: ['never', 'not', "doesn't", "don't", 'avoid'], minWords: 2 };
  const greenMerge = { mustContainOneOf: ['merge'], mustAlsoContainOneOf: ['never', 'not', "doesn't", "don't", 'avoid', 'green', 'only', 'wait'], minWords: 2 };
  const postgres = { mustContainOneOf: ['postgres'], mustAlsoContainOneOf: ['default', 'never', 'not', 'over mysql'] };
  const denoQuotes = { mustContainOneOf: ['deno', 'quote'], mustAlsoContainOneOf: ['deno', 'double'] };

  it("mustAlsoContainOneOf: on-topic values missing every direction token score 'inverted', not ok/off_topic", () => {
    expect(scoreFactValue(forcePush, { key: 'k', value: 'force pushes to shared branches' })).toBe('inverted');
    expect(scoreFactValue(greenMerge, { key: 'k', value: 'merges while red' })).toBe('inverted');
    expect(scoreFactValue(denoQuotes, { key: 'k', value: 'single quotes' })).toBe('inverted');
    expect(scoreFactValue(postgres, { key: 'k', value: 'prefers mysql over postgres' })).toBe('inverted');
  });

  it("mustNotContainAnyOf: naming the disfavored alternative scores 'inverted'", () => {
    expect(scoreFactValue({ mustContainOneOf: ['tab'], mustNotContainAnyOf: ['space'] }, { key: 'k', value: 'spaces over tabs' })).toBe('inverted');
    expect(scoreFactValue({ mustContainOneOf: ['vitest'], mustNotContainAnyOf: ['jest'] }, { key: 'k', value: 'jest over vitest' })).toBe('inverted');
  });

  it('correct direction-carrying values still score ok', () => {
    expect(scoreFactValue(forcePush, { key: 'k', value: 'never force-pushes to shared branches' })).toBe('ok');
    expect(scoreFactValue(forcePush, { key: 'k', value: "doesn't force push" })).toBe('ok');
    expect(scoreFactValue(greenMerge, { key: 'k', value: 'only merges when the pipeline is green' })).toBe('ok');
    expect(scoreFactValue(postgres, { key: 'k', value: 'uses postgres by default' })).toBe('ok');
    // The 3B's LIVE correct form for "X, never Y" transcripts is the comparison echo (observed at temp 0):
    // the phrase token 'over mysql' encodes word ORDER, which a bare mustNot ['mysql'] ban cannot —
    // regression-pinned so the guard never re-penalizes the model's natural correct phrasing.
    expect(scoreFactValue(postgres, { key: 'k', value: 'prefers postgres over mysql' })).toBe('ok');
    expect(scoreFactValue(denoQuotes, { key: 'k', value: 'double quotes in ts files' })).toBe('ok');
    expect(scoreFactValue(denoQuotes, { key: 'k', value: 'deno for scripts' })).toBe('ok'); // multi-fact: either fact, right direction
    expect(scoreFactValue({ mustContainOneOf: ['tab'], mustNotContainAnyOf: ['space'] }, { key: 'k', value: 'tab characters' })).toBe('ok'); // bare favored noun under mustNot stays ok
  });

  it('polarity is judged only AFTER the topic: off-topic stays off_topic, thin stays too_thin', () => {
    expect(scoreFactValue(forcePush, { key: 'k', value: 'writes conventional commits' })).toBe('off_topic');
    expect(scoreFactValue(forcePush, { key: 'k', value: 'push' })).toBe('too_thin');
  });

  it('guards use the same whole-word-START matcher (no incidental substrings)', () => {
    // 'npm' must NOT match inside 'pnpm' — the supersede guard rejects only the OLD tool
    expect(scoreFactValue({ mustContainOneOf: ['pnpm'], mustNotContainAnyOf: ['npm'] }, { key: 'k', value: 'pnpm' })).toBe('ok');
    expect(scoreFactValue({ mustContainOneOf: ['pnpm'], mustNotContainAnyOf: ['npm'] }, { key: 'k', value: 'switched from pnpm to npm' })).toBe('inverted');
  });
});

describe('summarize — accuracy + per-failure-mode breakdown', () => {
  it('counts modes, computes accuracy = ok / total', () => {
    const s = summarize(['ok', 'ok', 'wrong_command', 'bad_json']);
    expect(s.total).toBe(4);
    expect(s.ok).toBe(2);
    expect(s.accuracy).toBeCloseTo(0.5);
    expect(s.byMode).toEqual({ ok: 2, wrong_command: 1, bad_json: 1 });
  });
  it('is safe on an empty set (accuracy 0, no divide-by-zero)', () => {
    expect(summarize([])).toEqual({ total: 0, ok: 0, accuracy: 0, byMode: {} });
  });
});
