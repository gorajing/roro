// src/renderer/voice/voicePacks.ts — the voice-pack catalog + selection (Phase 5, the cosmetics bridge).
//
// Voice packs are roro's first monetizable COSMETIC: a free default voice (af_heart) + paid bundles. Each
// pack is a Kokoro voice id (the style .bin is fetched on demand by kokoroSynthesize.ts), with display +
// tier metadata for the future store. The engine already takes an injected voiceId: () => string; Phase 5
// makes that selection a real, validated, runtime-switchable thing.
//
// ENTITLEMENT IS OUT OF SCOPE here: the `tier` field is the DATA the store will render and gate on, but no
// purchase/ownership check exists yet (the store is gated by the cosmetics willingness-to-pay validation).
// All catalogued voices are selectable today; entitlement slots in at createVoiceSelection.set() later.

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

const BY_ID = new Map(VOICE_PACKS.map((p) => [p.id, p]));

export function listVoicePacks(): readonly VoicePack[] {
  return VOICE_PACKS;
}

export function getVoicePack(id: string): VoicePack | undefined {
  return BY_ID.get(id);
}

/** A known voice id passes through; anything else (unknown/empty/undefined) → the free default. */
export function resolveVoiceId(id: string | undefined): string {
  return id && BY_ID.has(id) ? id : DEFAULT_VOICE_ID;
}

export interface VoiceSelection {
  /** The currently selected (always-valid) voice id — read by the engine's voiceId injectable each speak. */
  current(): string;
  /** Switch voice. An UNKNOWN id is ignored (the current selection stands — a bad pick never silences the cat). */
  set(id: string): void;
}

/** Hold the active voice selection. `initial` is resolved (a bad initial → the default). */
export function createVoiceSelection(initial?: string): VoiceSelection {
  let selected = resolveVoiceId(initial);
  return {
    current: () => selected,
    set: (id) => {
      if (BY_ID.has(id)) selected = id; // entitlement gating would also check ownership here later
    },
  };
}
