// src/renderer/voice/nonSpeechFilter.ts — drop whisper's non-speech annotations.
//
// On non-speech audio (music, a slam, silence) whisper emits a single bracketed/parenthesized ANNOTATION —
// "[Music]", "[BLANK_AUDIO]", "(applause)" — not words. The VAD gates most non-speech, but a false-positive
// segment can still reach STT; committing such a tag as a spoken command would violate mouth-not-brain (the
// cat would "act" on a door slam). The whisper wrapper uses this to return '' for those, so the engine's
// existing empty-transcript guard drops them. Pure + unit-tested so the heavy STT glue needs no test.

/**
 * True when the WHOLE transcript is a single bracketed/parenthesized non-speech tag (e.g. "[Music]",
 * "[BLANK_AUDIO]", "(applause)"). A real command — even one that merely contains brackets, or has words
 * around them — returns false. Empty/whitespace returns false (handled separately by the engine).
 */
export function isNonSpeechAnnotation(text: string): boolean {
  // ^[[(]  start with [ or (   then  [^\])]*  any run of non-closing chars  then  [\])]$  a single ] or )
  // at end. "[Music] then commit" fails (trailing words); "set timeout [5] s" fails (doesn't start with a
  // bracket); "" fails (no bracket) — exactly the carve-outs we want.
  return /^[[(][^\])]*[\])]$/.test(text.trim());
}
