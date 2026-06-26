import { describe, expect, it } from 'vitest';
import { clarifyForReferentlessRequest, __test } from './clarifyGate';
import { DECIDE_CASES } from './eval/fixtures';

describe('clarifyForReferentlessRequest', () => {
  it.each([
    ['fix it', /what should i fix/i],
    ['please make it better', /what should i improve/i],
    ['update it', /what should i update/i],
    ['do that thing we talked about', /where should i apply it/i],
    ['change the color', /what should change color/i],
  ])('clarifies referent-less request: %s', (transcript, question) => {
    const decision = clarifyForReferentlessRequest({ transcript });

    expect(decision?.command).toBe('clarify');
    expect(decision?.narration).toMatch(question);
    expect(decision?.args.question).toBe(decision?.narration);
  });

  it.each([
    'fix the failing test in calc.py',
    'make the signup form better by adding validation',
    'update the README quick start',
    'change the button color to blue in src/App.tsx',
    "what's this error on my screen?",
  ])('does not clarify concrete task: %s', (transcript) => {
    expect(clarifyForReferentlessRequest({ transcript })).toBeNull();
  });

  it('still clarifies when memory contains only durable profile facts', () => {
    const decision = clarifyForReferentlessRequest({
      transcript: 'fix it',
      memory: 'KNOWN ABOUT THIS USER:\n- prefers Zustand',
    });

    expect(decision?.command).toBe('clarify');
  });

  it('lets the model decide when related past context or screen context may resolve the referent', () => {
    expect(clarifyForReferentlessRequest({
      transcript: 'fix it',
      memory: 'RELATED PAST CONTEXT:\n- user just asked about the failing settings test',
    })).toBeNull();
    expect(clarifyForReferentlessRequest({
      transcript: 'fix it',
      screen: 'The screen shows a settings dialog with an error.',
    })).toBeNull();
  });

  it('normalizes polite voice-style wrappers', () => {
    expect(__test.normalizeTranscript('Hey Roro, can you fix it please?')).toBe('fix it');
  });

  it('detects related past context without treating profile-only facts as a referent', () => {
    expect(__test.hasRelatedPastContext('KNOWN ABOUT THIS USER:\n- prefers short PRs')).toBe(false);
    expect(__test.hasRelatedPastContext('RELATED PAST CONTEXT:\n- failing settings test')).toBe(true);
  });

  it('covers every current clarify fixture and no non-clarify fixtures', () => {
    for (const c of DECIDE_CASES) {
      const decision = clarifyForReferentlessRequest(c.input);
      if (c.expect === 'clarify') {
        expect(decision?.command, c.id).toBe('clarify');
      } else {
        expect(decision, c.id).toBeNull();
      }
    }
  });
});
