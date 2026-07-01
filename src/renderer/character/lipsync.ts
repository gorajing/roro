// src/renderer/character/lipsync.ts — amplitude-driven mouth movement.
//
// Feed setAmplitude() from the on-device TTS amplitude (0..1) while the assistant
// speaks. A ticker registered at UPDATE_PRIORITY.LOW smooths the amplitude and
// drives the cat's mouth graphic each frame.

import * as PIXI from 'pixi.js';
import type { Avatar } from './avatar';

const SMOOTHING = 0.35; // exponential smoothing factor; higher = snappier

export class AmplitudeLipSync {
  private target = 0;
  private value = 0;
  private bound = false;

  constructor(private avatar: Avatar) {}

  /** Latest amplitude from the on-device TTS (clamped 0..1). */
  setAmplitude(a: number): void {
    this.target = Math.max(0, Math.min(1, a));
  }

  start(): void {
    if (this.bound) return;
    this.bound = true;
    this.avatar.app.ticker.add(this.tick, this, PIXI.UPDATE_PRIORITY.LOW);
  }

  stop(): void {
    if (!this.bound) return;
    this.avatar.app.ticker.remove(this.tick, this);
    this.bound = false;
    this.value = this.target = 0;
    this.apply(0);
  }

  private tick = (): void => {
    this.value += (this.target - this.value) * SMOOTHING;
    this.apply(this.value);
  };

  private apply(v: number): void {
    this.avatar.cat.setMouthOpen(v);
  }
}
