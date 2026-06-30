// src/renderer/character/petState.ts — the pet-state model, SEPARATE from AvatarState
// (PRODUCT_PLAN Immediate Build List #1: "Add a pet-state model separate from `AvatarState`").
//
// AvatarState (the 6 canonical states) reflects AGENT ACTIVITY and drives the canonical pose.
// PetState is the orthogonal INNER LIFE — mood / energy / attention — that *modulates* expression
// without inventing a 7th avatar state (the avatar union stays frozen; see src/shared/avatar.ts).
//
// This is a PURE projection over (avatarState, idle-energy, interaction signals): the caller computes
// the time-windowed inputs (energy from Activity, recentlyPetted from a pet/poke timestamp), so this
// module unit-tests with no Pixi, no timers, and no Date.now() — same as activity.ts.

import type { AvatarState } from '../../shared/avatar';
import type { Energy } from './activity';

export type { Energy };

/** The emotional tone the pet projects. Orthogonal to AvatarState. */
export type PetMood = 'sleepy' | 'curious' | 'playful' | 'focused' | 'proud' | 'worried';

/** What the pet is attending to right now. */
export type Attention = 'idle' | 'watching-cursor' | 'listening' | 'working';

export interface PetState {
  mood: PetMood;
  energy: Energy;
  attention: Attention;
}

/** Signals PetState derives from. Time-windowed booleans are computed by the caller (energy from
 *  Activity.energy(now), recentlyPetted from a pet/poke timestamp) to keep this pure + deterministic. */
export interface PetStateInput {
  /** Agent-activity state (from eventToAvatarState); null before the first event. */
  avatarState: AvatarState | null;
  /** Idle-derived energy (from Activity.energy(now)). */
  energy: Energy;
  /** The eyes are actively tracking the cursor (hover / gaze on). */
  cursorTracked: boolean;
  /** A live voice / mic listening session is active. */
  listening: boolean;
  /** A pet / poke happened within the recent "playful" window. */
  recentlyPetted: boolean;
}

/** What the pet is attending to: active work > listening > the cursor > nothing. */
function deriveAttention(i: PetStateInput): Attention {
  if (i.avatarState === 'working' || i.avatarState === 'thinking') return 'working';
  if (i.avatarState === 'listening' || i.listening) return 'listening';
  if (i.cursorTracked) return 'watching-cursor';
  return 'idle';
}

/** Emotional tone, by priority: distress > pride > active focus > play > rest > contented idle.
 *  Active agent states beat idle-energy so a working pet never reads "sleepy"; a fresh pet always
 *  reads "playful" (it just got attention). Energy stays a separate axis on PetState. */
function deriveMood(i: PetStateInput): PetMood {
  if (i.avatarState === 'error') return 'worried';
  if (i.avatarState === 'done') return 'proud';
  if (i.avatarState === 'working' || i.avatarState === 'thinking') return 'focused';
  if (i.recentlyPetted) return 'playful';
  if (i.energy === 'asleep' || i.energy === 'drowsy') return 'sleepy';
  return 'curious';
}

/** Pure projection of the inner-life pet-state. Deterministic: same input → same PetState. */
export function derivePetState(input: PetStateInput): PetState {
  return {
    mood: deriveMood(input),
    energy: input.energy,
    attention: deriveAttention(input),
  };
}
