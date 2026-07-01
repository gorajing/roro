// src/renderer/character/stateMachine.ts — maps the 6 canonical AvatarStates to
// the cat's expression/posture (via Cat.setState) + label. Idempotent: re-setting
// the same state is a no-op so the animation doesn't re-fire each frame.

import type { AvatarState } from '../../shared/avatar';
import type { Avatar } from './avatar';

/** Per-state accent color handed to Cat.setState. */
const STATE_COLOR: Record<AvatarState, number> = {
  idle: 0x8a8aff,
  listening: 0x4caf50,
  thinking: 0xffb300,
  working: 0x29b6f6,
  done: 0x66bb6a,
  error: 0xef5350,
};

export class AvatarStateMachine {
  private current: AvatarState | null = null;

  constructor(private avatar: Avatar) {}

  get state(): AvatarState | null {
    return this.current;
  }

  setState(state: AvatarState): void {
    if (state === this.current) return; // idempotent
    this.current = state;
    this.avatar.cat.setState(state, STATE_COLOR[state]);
    this.avatar.cat.setLabel(state);
  }
}
