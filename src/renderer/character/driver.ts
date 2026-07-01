// src/renderer/character/driver.ts — the CharacterDriver facade.
//
// Wraps AvatarStateMachine + AmplitudeLipSync behind the character-agnostic
// CharacterDriver surface. Voice and the action-event pipeline only ever see
// setState / setActivity / setMouthOpen / setTalking / speak — the pixel cat
// is an implementation detail behind this seam.

import { createAvatar, type Avatar } from './avatar';
import { AvatarStateMachine } from './stateMachine';
import { AmplitudeLipSync } from './lipsync';
import type { ActivityCue, CharacterDriver } from './types';
import type { AvatarState } from '../../shared/avatar';
import type { GazeTarget } from '../../shared/gaze';

class CatCharacterDriver implements CharacterDriver {
  private readonly sm: AvatarStateMachine;
  private readonly lipsync: AmplitudeLipSync;

  constructor(private readonly avatar: Avatar) {
    this.sm = new AvatarStateMachine(avatar);
    this.lipsync = new AmplitudeLipSync(avatar);
    // Amplitude lip-sync runs for the whole session; we only feed it 0 when the
    // assistant isn't talking, so the mouth rests closed.
    this.lipsync.start();
  }

  get state(): AvatarState | null {
    return this.sm.state;
  }

  setState(s: AvatarState): void {
    this.sm.setState(s);
  }

  setActivity(cue: ActivityCue | null): void {
    this.avatar.cat.setActivity(cue);
  }

  setMouthOpen(v: number): void {
    this.lipsync.setAmplitude(v);
  }

  setTalking(talking: boolean): void {
    // The 6 canonical states have no 'talking'; we keep state untouched and use
    // this only as a hook (and to rest the mouth closed when talk ends). The cat
    // uses it for its speech signal and mouth rest.
    this.avatar.cat.setTalking(talking);
    if (!talking) this.lipsync.setAmplitude(0);
  }

  setMuted(muted: boolean): void {
    this.avatar.cat.setMuted(muted);
    if (muted) this.lipsync.setAmplitude(0);
  }

  setGaze(target: GazeTarget | null): void {
    this.avatar.cat.setGaze(target);
  }

  pet(): void {
    this.avatar.cat.pet();
  }

  poke(): void {
    this.avatar.cat.poke();
  }

  setBusy(busy: boolean): void {
    this.avatar.cat.setBusy(busy);
  }

  setInCall(active: boolean): void {
    this.avatar.cat.setInCall(active);
  }

  speak(audioUrl: string, onFinish?: () => void): void {
    // The cat has no clip-driven lip-sync (audio playback is the voice layer's
    // concern; live amplitude arrives via setMouthOpen). Fire onFinish so
    // callers' state transitions still proceed.
    void audioUrl;
    onFinish?.();
  }

  stopSpeaking(): void {
    this.lipsync.setAmplitude(0);
  }
}

export interface Character {
  driver: CharacterDriver;
  avatar: Avatar;
}

/**
 * Build the avatar + its CharacterDriver. Always resolves — the pixel cat is
 * procedural, so the rest of the renderer always has a driver.
 */
export async function createCharacter(canvas: HTMLCanvasElement): Promise<Character> {
  const avatar = await createAvatar(canvas);
  const driver = new CatCharacterDriver(avatar);
  driver.setState('idle');
  return { driver, avatar };
}
