// src/shared/voicePacks.ts — the voice-pack CATALOG (pure data), shared by the voice engine + the store.
//
// Voice packs are roro's first monetizable COSMETIC: a free default voice (af_heart) + paid bundles. Each
// pack is a Kokoro voice id (the style .bin is fetched on demand by the voice engine), with display + tier
// metadata for the store. THIS module is deliberately data-only — it imports nothing from the voice runtime
// (no transformers/onnx) — so the WS5 cosmetics fake-door can list paid packs without depending on the voice
// subsystem (the seam that lets the renderer's voice subsystem move into its own package). The
// selection/validation runtime stays with the engine (its voicePacks.ts consumes + re-exports this catalog).

export type VoiceTier = 'free' | 'paid';

export interface VoicePack {
  /** Kokoro voice id (e.g. 'af_heart'); the voices/<id>.bin is fetched on demand. */
  id: string;
  /** Display name for the store / picker. */
  name: string;
  tier: VoiceTier;
  accent: 'us' | 'gb';
  gender: 'f' | 'm';
}

export const DEFAULT_VOICE_ID = 'af_heart'; // the A-graded en-us default; free, always available

// A curated catalog of real Kokoro-82M v1.0 voices. af_heart is free; the rest are the paid bundle (the
// cosmetics hook). Kept small + hand-picked rather than exposing all 55 — quality over quantity.
export const VOICE_PACKS: readonly VoicePack[] = [
  { id: 'af_heart', name: 'Heart', tier: 'free', accent: 'us', gender: 'f' },
  { id: 'af_bella', name: 'Bella', tier: 'paid', accent: 'us', gender: 'f' },
  { id: 'am_michael', name: 'Michael', tier: 'paid', accent: 'us', gender: 'm' },
  { id: 'bf_emma', name: 'Emma', tier: 'paid', accent: 'gb', gender: 'f' },
  { id: 'bm_george', name: 'George', tier: 'paid', accent: 'gb', gender: 'm' },
];
