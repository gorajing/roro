// packages/voice/src/characterSeam.ts — structural mirrors of the app's character seam.
//
// DUPLICATE-CHECK: these two interfaces mirror the slices of src/renderer/character/types.ts that the
// voice runtime consumes (CharacterDriver.poke + CaptionSink). This package deliberately does NOT import
// app renderer internals — TypeScript's structural typing re-checks compatibility at the bootstrap call
// site when voice re-integrates (the app's CharacterDriver/CaptionPanel satisfy these shapes as-is).
// If the app-side seam changes, update these mirrors to match.

/** The slice of the app's CharacterDriver the voice path drives: the ear-perk/awake poke. */
export interface VoiceCharacterDriver {
  /** Register a real interaction (keeps the cat awake / un-throttled). */
  poke?(): void;
}

/** Sink for the live captions / transcript line (mirror of the app's CaptionSink). */
export interface CaptionSink {
  update(role: 'user' | 'assistant', text: string, isFinal: boolean): void;
}
