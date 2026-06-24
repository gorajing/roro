import { describe, it, expect } from 'vitest';
import { isNonSpeechAnnotation } from './nonSpeechFilter';

// Whisper emits a bracketed/parenthesized ANNOTATION (not words) when handed non-speech audio — music, a
// door slam, silence. The VAD gates most non-speech, but a false-positive segment can still reach STT, and
// such an annotation must NEVER be committed as a spoken command (mouth-not-brain). This guard lets the
// whisper wrapper return '' for those so the engine's empty-guard drops them. Real words — even one — pass.

describe('isNonSpeechAnnotation — drop whisper non-speech tags, keep real commands', () => {
  it('flags a transcript that is ONLY a bracketed non-speech tag', () => {
    for (const tag of ['[Music]', '[BLANK_AUDIO]', '[ Silence ]', '[Applause]', '(applause)']) {
      expect(isNonSpeechAnnotation(tag)).toBe(true);
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(isNonSpeechAnnotation('  [Music]  ')).toBe(true);
  });

  it('does NOT flag real commands — even short ones, and ones that merely contain brackets', () => {
    for (const cmd of ['add a logout route', 'yes', 'stop', 'set the timeout to [5] seconds', '[Music] then commit']) {
      expect(isNonSpeechAnnotation(cmd)).toBe(false);
    }
  });

  it('does NOT flag empty/whitespace (the engine handles those separately)', () => {
    expect(isNonSpeechAnnotation('')).toBe(false);
    expect(isNonSpeechAnnotation('   ')).toBe(false);
  });
});
