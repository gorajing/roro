// src/renderer/character/petExpression.ts — maps the inner-life PetState onto cheap, additive
// expression modulations the procedural avatar applies. PURE + deterministic (no Pixi), so the
// "how a mood reads" logic unit-tests; the avatar just applies the returned numbers.
//
// Behavior-preserving baseline: the resting cat is `curious`, which maps to the avatar's existing
// neutral values — so wiring this in changes nothing until the pet's mood actually shifts.

import type { PetState } from './petState';

export interface ExpressionMods {
  /** Tail-wag period in ticks (smaller = faster wag). 24 is the avatar's neutral default. */
  tailWagPeriod: number;
}

/** The neutral baseline = today's avatar values. `curious` resolves here. */
export const NEUTRAL_EXPRESSION: ExpressionMods = { tailWagPeriod: 24 };

/** Map mood → expression modulation. (energy / attention are reserved for future channels.) */
export function petExpression(state: PetState): ExpressionMods {
  switch (state.mood) {
    case 'playful': return { tailWagPeriod: 14 }; // quick, happy flicks
    case 'proud':   return { tailWagPeriod: 18 }; // perky
    case 'curious': return NEUTRAL_EXPRESSION;    // the resting default — unchanged
    case 'focused': return { tailWagPeriod: 36 }; // slow, steady
    case 'worried': return { tailWagPeriod: 36 }; // low and slow
    case 'sleepy':  return { tailWagPeriod: 48 }; // barely moving
    default: {
      // Exhaustiveness: a new PetMood must be a deliberate expression decision, not a silent default.
      const _exhaustive: never = state.mood;
      return _exhaustive ?? NEUTRAL_EXPRESSION;
    }
  }
}
