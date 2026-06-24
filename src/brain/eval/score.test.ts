import { describe, it, expect } from 'vitest';
import { scoreDecision, scoreExtraction, summarize } from './score';

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
