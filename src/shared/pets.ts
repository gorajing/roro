// src/shared/pets.ts — the `-ro` pet-variant catalog (the cosmetic "catalog spine", per HANDOFF §7).
//
// Cosmetics monetize the BOND via buy-once ASSETS that run locally (alternate pets, items, voice
// packs) — never metered cloud. THIS file is the catalog FOUNDATION only: the variant model + the
// roster + lookups, all pure data driving the procedural PixiJS cat's palette. The STORE / payments /
// creator marketplace are deliberately NOT here — §7 says validate (will devs pay?) before building
// the store, so this stays the free, technical foundation the store would later sit on.
//
// Roro = flagship/default; Miro, Sero, Taro = the first collectible alternates, named after the
// founder's real pets (the authentic origin story + the cosmetic cold-start fix). A new character
// just needs a `-ro` name (isRoName).

export interface PetPalette {
  /** The procedural cat's main body color (hex). */
  body: string;
  /** Ears / markings accent (hex). */
  accent: string;
  /** Eye color (hex). */
  eyes: string;
}

export interface PetVariant {
  /** Stable id = the `-ro` name, lowercase (roro, miro, sero, taro). */
  id: string;
  /** Display name. */
  name: string;
  /** The authentic origin (a real pet) — the story that makes the roster credible. */
  origin: string;
  palette: PetPalette;
  /** Exactly one variant is the default (Roro, the flagship). */
  isDefault: boolean;
}

export const PET_VARIANTS: readonly PetVariant[] = [
  { id: 'roro', name: 'Roro', origin: 'the flagship', isDefault: true, palette: { body: '#3a3f4b', accent: '#f4a259', eyes: '#9be7c4' } },
  { id: 'miro', name: 'Miro', origin: "a founder's cat", isDefault: false, palette: { body: '#e8e3da', accent: '#c97b5a', eyes: '#6fb1d6' } },
  { id: 'sero', name: 'Sero', origin: "a founder's cat", isDefault: false, palette: { body: '#1f2933', accent: '#7c5cff', eyes: '#ffd166' } },
  { id: 'taro', name: 'Taro', origin: "a founder's cat", isDefault: false, palette: { body: '#5a3e2b', accent: '#e0c097', eyes: '#a3d9a5' } },
];

export function listPets(): readonly PetVariant[] {
  return PET_VARIANTS;
}

export function getPet(id: string): PetVariant | undefined {
  return PET_VARIANTS.find((p) => p.id === id.trim().toLowerCase());
}

/** The flagship/default pet (always present). */
export function defaultPet(): PetVariant {
  return PET_VARIANTS.find((p) => p.isDefault) ?? PET_VARIANTS[0];
}

/** Resolve a selected pet id to a variant, falling back to the default for an unknown/empty id. */
export function resolvePet(id: string | null | undefined): PetVariant {
  return (id ? getPet(id) : undefined) ?? defaultPet();
}

/** A character qualifies for the roster iff it has a `-ro` name (the catalog extensibility rule). */
export function isRoName(name: string): boolean {
  return /^[a-z]+ro$/i.test(name.trim());
}
