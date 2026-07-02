import { describe, expect, it } from 'vitest';
import { buildTraceReview, parseTraceJsonl, renderTraceReviewMarkdown } from './cohortTraceReview';

describe('cohort trace review', () => {
  it('summarizes extraction and recall events without printing private text', () => {
    const events = parseTraceJsonl([
      JSON.stringify({
        ts: '2026-06-27T00:00:00.000Z',
        kind: 'recall',
        ownerId: 'owner-1',
        query: 'please remember my secret repo codename',
        text: 'private memory text that must not be printed',
        candidates: [
          { id: 'e1', score: 0.9, parts: {}, returned: true, text: 'private candidate text' },
          { id: 'e2', score: 0.2, parts: {}, returned: false },
        ],
      }),
      JSON.stringify({
        ts: '2026-06-27T00:00:01.000Z',
        kind: 'extract',
        ownerId: 'owner-1',
        sessionId: 'session-1',
        outcome: 'answered',
        stage: 'noop',
        reason: 'model_null',
        transcript: 'private tester transcript',
      }),
    ].join('\n'));

    const review = buildTraceReview(events, '/tmp/roro.trace.jsonl');
    expect(review.byKind).toEqual({ recall: 1, extract: 1 });
    expect(review.extractByStage).toEqual({ noop: 1 });
    expect(review.recalls).toEqual([{ ts: '2026-06-27T00:00:00.000Z', queryMode: 'plaintext', candidateCount: 2, returnedCount: 1 }]);

    const markdown = renderTraceReviewMarkdown(review);
    expect(markdown).toContain('plaintext (not printed)');
    expect(markdown).toContain('model_null');
    expect(markdown).not.toContain('secret repo');
    expect(markdown).not.toContain('private memory text');
    expect(markdown).not.toContain('private candidate text');
    expect(markdown).not.toContain('private tester transcript');
  });

  it('fails loudly on malformed trace lines', () => {
    expect(() => parseTraceJsonl('{"kind":"recall"}\nnot-json')).toThrow(/line 2/);
    expect(() => parseTraceJsonl('{"ts":"x"}')).toThrow(/string kind/);
  });

  it('redacts failed extraction reasons because they can contain local paths or secrets', () => {
    const events = parseTraceJsonl(JSON.stringify({
      kind: 'extract',
      sessionId: 'session-1',
      outcome: 'answered',
      stage: 'failed',
      reason: 'disk full at /Users/person/SecretClient/repo',
    }));

    const markdown = renderTraceReviewMarkdown(buildTraceReview(events));
    expect(markdown).toContain('failed (reason withheld)');
    expect(markdown).not.toContain('SecretClient');
  });
});
