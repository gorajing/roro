// packages/voice/src/kokoroG2P.ts — English text → Kokoro-ready IPA, license-clean (MIT).
//
// Kokoro is a PHONEME-input model. The popular kokoro-js path phonemizes via espeak-ng (GPLv3) — which we
// CANNOT ship. We use `phonemize` (MIT, pure-JS, no espeak, no WASM): its main entry auto-registers an
// English rule+dictionary G2P and emits IPA with stress marks. The ONE gap: phonemize emits ɫ (dark-L) and
// ɝ (rhotic schwa) which are NOT in Kokoro's 115-char vocab, and Kokoro silently drops unknown chars — so
// normalizeKokoroIpa MUST run before tokenizing or ~37% of words lose their L / r-colored vowel.

import { phonemize } from 'phonemize'; // main entry = English-only; NO espeak/phonemizer (verified MIT)

// The load-bearing fixups: each maps an out-of-vocab phonemize symbol to the nearest IN-vocab Kokoro symbol.
// Every other phonemize symbol (ʤ ʧ ɹ θ ʃ ɚ, stress ˈ ˌ, length ː …) is already in Kokoro's vocab.
const KOKORO_FIXUPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ɫ/g, 'l'], // dark-L → l  (Kokoro vocab id 54)
  [/ɝ/g, 'ɚ'], // stressed rhotic schwa → ɚ  (Kokoro vocab id 85, in-vocab)
];

/** Map phonemize IPA into Kokoro's vocabulary so no symbol is silently dropped at tokenization. Pure. */
export function normalizeKokoroIpa(ipa: string): string {
  let out = ipa;
  for (const [re, to] of KOKORO_FIXUPS) out = out.replace(re, to);
  return out;
}

/** English text → normalized IPA ready for Kokoro's tokenizer. */
export function textToKokoroIpa(text: string): string {
  return normalizeKokoroIpa(phonemize(text));
}
