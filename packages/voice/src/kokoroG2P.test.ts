import { describe, it, expect } from 'vitest';
import { normalizeKokoroIpa, textToKokoroIpa } from './kokoroG2P';

// phonemize emits two IPA symbols that are NOT in Kokoro's 115-char vocab — ɫ (dark-L) and ɝ (stressed
// rhotic schwa). Kokoro SILENTLY DROPS unknown chars, so without normalization ~37% of common words lose
// their L / r-colored vowel (verified by research). The normalizer maps them to the nearest in-vocab
// symbol — this is the load-bearing correctness step for Phase 3 TTS.

describe('normalizeKokoroIpa — map phonemize IPA into Kokoro’s vocab', () => {
  it('maps dark-L ɫ → l and rhotic schwa ɝ → ɚ', () => {
    expect(normalizeKokoroIpa('həˈɫoʊ ˈwɝɫd')).toBe('həˈloʊ ˈwɚld'); // "hello world"
  });

  it('leaves already-in-vocab IPA untouched (incl. stress marks ˈ ˌ ː and ɚ θ ɹ ʃ)', () => {
    expect(normalizeKokoroIpa('ˈðə ˌɹɛd ʃiːp')).toBe('ˈðə ˌɹɛd ʃiːp');
  });

  it('maps every occurrence, not just the first', () => {
    expect(normalizeKokoroIpa('ɫɫ ɝɝ')).toBe('ll ɚɚ');
  });
});

describe('textToKokoroIpa — English text → Kokoro-ready IPA (phonemize + normalize)', () => {
  it('produces NO out-of-vocab ɫ/ɝ (the guarantee Kokoro relies on)', () => {
    const ipa = textToKokoroIpa('hello world');
    expect(ipa).not.toMatch(/[ɫɝ]/); // load-bearing: nothing Kokoro would silently drop
    expect(ipa).toMatch(/l/); // the dark-L became a plain l
    expect(ipa.length).toBeGreaterThan(0);
  });

  it('leaves NO ɫ/ɝ across a corpus of L-heavy + R-colored words (broad coverage of the gap)', () => {
    // dark-L words (ball/call/full/well/small/tall) + rhotic-schwa words (girl/bird/word/work/first/nurse/turn).
    const words = 'ball call full well small tall hello world girl bird word work first nurse turn early learn'.split(' ');
    for (const w of words) {
      const ipa = textToKokoroIpa(w);
      expect(ipa, `'${w}' → '${ipa}' still carries an out-of-vocab symbol Kokoro would drop`).not.toMatch(/[ɫɝ]/);
    }
  });
});
