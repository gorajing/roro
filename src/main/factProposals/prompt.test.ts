import { describe, expect, it } from 'vitest';
import { buildProposalPrompt } from './prompt';
import type { RunDigest } from './types';

describe('buildProposalPrompt — privacy by construction', () => {
  it('is a pure function of a RunDigest literal ALONE (no transcript, no narration, no memory)', () => {
    // THE privacy guard: this test constructs the prompt from nothing but a RunDigest literal.
    // If a future edit makes the prompt depend on recalled memory, profile facts, the raw
    // transcript, or 3B narration, it cannot be built from this input and the suite goes red.
    const digest: RunDigest = {
      runId: 'r1', sessionId: 's1', repo: '/tmp/x', agent: 'claude',
      task: 'rename the auth helper', outcome: 'completed',
      finalText: 'Renamed and updated call sites.',
      commands: ['npm test'], files: [{ path: 'src/auth.ts', op: 'update' }], messages: ['Done.'],
    };
    const p = buildProposalPrompt(digest);
    expect(p).toContain('rename the auth helper');
    expect(p).toContain('npm test');
    expect(p).toContain('src/auth.ts');
  });

  it('carries the null-discipline instruction (most runs teach nothing durable)', () => {
    const digest: RunDigest = {
      runId: 'r', sessionId: 's', repo: '/r', agent: 'codex', task: 't', outcome: 'completed',
      commands: [], files: [], messages: [],
    };
    const p = buildProposalPrompt(digest);
    expect(p).toMatch(/\[\]/); // the empty-array escape hatch is explicit
    expect(p.toLowerCase()).toMatch(/most runs|nothing durable/);
    expect(p.toLowerCase()).toContain('verbatim');
    expect(p).toMatch(/at most 2/i);
  });
});
