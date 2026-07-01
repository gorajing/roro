// src/renderer/voice/voicePacks.ts — voice-pack selection runtime (Phase 5, the cosmetics bridge).
//
// Voice packs are roro's first monetizable COSMETIC: a free default voice (af_heart) + paid bundles. The
// CATALOG itself (VoicePack type + VOICE_PACKS data) lives in src/shared/voicePacks.ts — a data-only module
// the cosmetics store also reads, so the store never depends on the voice subsystem (the seam that lets
// src/renderer/voice move into its own package). THIS file is the runtime side: validated lookup + a
// runtime-switchable selection feeding the engine's injected voiceId: () => string. The shared exports are
// re-exported here so voice-side consumers keep a single import path.
//
// ENTITLEMENT IS OUT OF SCOPE here: the `tier` field is the DATA the store will render and gate on, but no
// purchase/ownership check exists yet (the store is gated by the cosmetics willingness-to-pay validation).
// All catalogued voices are selectable today; entitlement slots in at createVoiceSelection.set() later.

import { DEFAULT_VOICE_ID, VOICE_PACKS } from '../../shared/voicePacks';
import type { VoicePack } from '../../shared/voicePacks';

export type { VoiceTier, VoicePack } from '../../shared/voicePacks';
export { DEFAULT_VOICE_ID, VOICE_PACKS } from '../../shared/voicePacks';

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
