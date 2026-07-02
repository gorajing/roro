import { describe, expect, it } from 'vitest';
import { admitProposals, parseProposals } from './admission';
import type { RunDigest } from './types';

const digest: RunDigest = {
  runId: 'r1',
  sessionId: 's1',
  repo: '/tmp/repo',
  agent: 'codex',
  task: 'add a logout route to the express app',
  outcome: 'completed',
  finalText: 'Added the logout route with a matching supertest spec, since the project keeps tests beside features.',
  commands: ['npm test -- --run', 'git status'],
  files: [{ path: 'src/routes/logout.ts', op: 'add' }],
  messages: ['I noticed the repo keeps tests beside features, so I added logout.test.ts alongside.'],
};

describe('parseProposals — strict, salvaging, never-throwing', () => {
  it('parses a clean JSON array', () => {
    const out = parseProposals('[{"key":"tests_location","value":"keeps tests beside features","evidence":"keeps tests beside features"}]');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('tests_location');
  });

  it('strips markdown fences', () => {
    const out = parseProposals('```json\n[{"key":"k","value":"v is long enough","evidence":"e"}]\n```');
    expect(out).toHaveLength(1);
  });

  it('salvages valid elements from a partially-garbage array', () => {
    const out = parseProposals('[{"key":"k","value":"good value here","evidence":"e"}, {"nope":true}, 42]');
    expect(out).toHaveLength(1);
  });

  it('returns [] for top-level garbage (traced upstream, never throws)', () => {
    expect(parseProposals('the user seems nice')).toEqual([]);
    expect(parseProposals('{"key":"not-an-array"}')).toEqual([]);
    expect(parseProposals('')).toEqual([]);
  });
});

describe('admitProposals — the deterministic channel gate (cost asymmetry: drop anything unproven)', () => {
  const raw = (over: Partial<{ key: string; value: string; evidence: string }> = {}) => [{
    key: 'tests_location',
    value: 'keeps tests beside features',
    evidence: 'keeps tests beside features',
    ...over,
  }];

  it('admits a grounded proposal (evidence is a verbatim digest substring)', () => {
    const out = admitProposals(raw(), { digest, existing: [] });
    expect(out).toHaveLength(1);
    expect(out[0].normalizedKey).toBe('tests_location');
  });

  it('REJECTS an ungrounded proposal — evidence not present in the digest', () => {
    const out = admitProposals(raw({ evidence: 'the user prefers tabs over spaces' }), { digest, existing: [] });
    expect(out).toEqual([]);
  });

  it('grounding is case- and whitespace-insensitive but still verbatim', () => {
    const out = admitProposals(raw({ evidence: 'Keeps  Tests   beside FEATURES' }), { digest, existing: [] });
    expect(out).toHaveLength(1);
  });

  it('REJECTS evidence shorter than the 12-char floor (trivial quotes ground nothing)', () => {
    const out = admitProposals(raw({ evidence: 'the repo' }), { digest, existing: [] });
    expect(out).toEqual([]);
  });

  it('REJECTS useless values via the shared extractFact guard (bare booleans poison recall)', () => {
    const out = admitProposals(raw({ value: 'true', evidence: 'keeps tests beside features' }), { digest, existing: [] });
    expect(out).toEqual([]);
  });

  it('REJECTS secret-shaped values (a fact row must never smuggle a credential)', () => {
    const out = admitProposals(
      raw({ value: 'sk-ant-api03-Zx9yQ21kfjshdfkjshdkfjhsdkfjhsdf', evidence: 'keeps tests beside features' }),
      { digest, existing: [] },
    );
    expect(out).toEqual([]);
  });

  it('caps admissions at 2 per run (confirm fatigue is the poison mode)', () => {
    const three = [
      { key: 'a_key', value: 'keeps tests beside features', evidence: 'keeps tests beside features' },
      { key: 'b_key', value: 'add a logout route', evidence: 'add a logout route' },
      { key: 'c_key', value: 'npm test -- --run', evidence: 'npm test -- --run' },
    ];
    expect(admitProposals(three, { digest, existing: [] })).toHaveLength(2);
  });

  it('drops an exact (key,value) duplicate of an existing active fact', () => {
    const out = admitProposals(raw(), {
      digest,
      existing: [{ key: 'tests_location', value: 'keeps tests beside features' }],
    });
    expect(out).toEqual([]);
  });

  it('ADMITS a same-key different-value proposal (a legitimate supersede candidate — the user decides)', () => {
    const out = admitProposals(raw(), {
      digest,
      existing: [{ key: 'tests_location', value: 'separate __tests__ directory' }],
    });
    expect(out).toHaveLength(1);
  });

  it('admits without dedupe when the profile is unavailable (memory down; confirm is the real gate)', () => {
    const out = admitProposals(raw(), { digest, existing: null });
    expect(out).toHaveLength(1);
  });

  it('normalizes keys through the shared extractFact normalizer (supersede matching is exact-key)', () => {
    const out = admitProposals(raw({ key: 'Tests-Location' }), { digest, existing: [] });
    expect(out[0]?.normalizedKey).toBe('tests_location');
  });
});
