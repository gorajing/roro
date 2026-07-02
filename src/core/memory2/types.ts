// src/memory2/types.ts — re-export of the canonical memory contract.
//
// The Entry model moved to src/shared/memory.ts in the W5 contract unification (one canonical home
// for the shapes that cross the main/renderer/module seams). This re-export keeps memory2's internal
// imports stable; new code outside memory2 should import from '../../shared/memory' directly.

export type { Tier, EpisodeKind, Entry, FactPayload } from '../../shared/memory';
