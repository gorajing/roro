// src/memory2/importance.ts — deterministic memory importance (1-10) by EPISODE KIND.
//
// Stamped at write so the recall blend (memoryScore.ts weights importance) can nudge the ranking WITHOUT
// trusting the 3B model to self-rate (the M2.5 lesson: a deterministic rule beats a noisy model for memory
// quality — a missed nudge is harmless, a model-inflated one poisons recall). The ordering is the contract:
// the user's OWN words (observation) above the cat's paraphrase (narration), so recall surfaces what the
// user actually said over how the cat restated it. Facts are a TIER, not a kind — they never enter the
// episodic blend (getProfile surfaces them separately), so they carry no importance row here.

import type { EpisodeKind } from '../../shared/memory';

const BY_KIND: Record<EpisodeKind, number> = {
  observation: 6,  // the user's own words (raw transcript)
  action: 4,       // what the agent did
  narration: 3,    // the cat's paraphrase — least load-bearing
};

export function importanceFor(kind: EpisodeKind): number {
  return BY_KIND[kind];
}
