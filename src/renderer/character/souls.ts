// src/renderer/character/souls.ts — the soul catalog: "one engine, many souls."
//
// A SOUL is a selectable companion (the cat, Miro the dog, ...). The engine (memory, turns, safety,
// pet-state, the CharacterDriver facade) is soul-agnostic; a soul only changes how the same events are
// EXPRESSED. Today exactly one soul has a real avatar renderer — the procedural cat, the shipping
// default. Other souls are reserved slots whose DISTINCT avatar art is pending: it needs visual
// authoring + review (the cat is the "de-facto product"), not a blind code guess. `hasRenderer` makes
// that honest so a selection UI can offer only souls that can actually be shown.
//
// Pure (no Pixi/DOM/IPC): id + name + species, resolved via the existing -ro roster in pets.ts.

import { resolvePet } from '../../shared/pets';

export type Species = 'cat' | 'dog';

export interface Soul {
  /** -ro id from the roster (roro, miro, sero, taro). */
  id: string;
  /** Display name. */
  name: string;
  /** What kind of creature this soul is. */
  species: Species;
  /** True when a distinct avatar renderer exists for this soul today (only the cat, for now). */
  hasRenderer: boolean;
}

// The -ro roster is cats by default (src/shared/pets.ts); Miro is reframed as the DOG per
// docs/COMPANION-ARCHITECTURE.md (superseding pets.ts' cat entry). Add entries here as souls gain art.
const SPECIES_BY_ID: Record<string, Species> = { roro: 'cat', miro: 'dog' };

const speciesFor = (id: string): Species => SPECIES_BY_ID[id] ?? 'cat';

/** Resolve a soul id to its descriptor, falling back to the flagship cat for unknown/empty ids. */
export function resolveSoul(id: string | null | undefined): Soul {
  const variant = resolvePet(id);
  const species = speciesFor(variant.id);
  return {
    id: variant.id,
    name: variant.name,
    species,
    hasRenderer: species === 'cat', // only the procedural cat renders today; dog art is pending
  };
}

/** The flagship cat — the shipping default soul. */
export const defaultSoul = (): Soul => resolveSoul(null);
