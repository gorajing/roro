// src/renderer/character/gaze.ts — eases the cat's gaze toward a target each tick.
// Pure (no Pixi); the renderer feeds step()'s rounded offsets into the eye pixels.

import type { GazeTarget } from '../../shared/gaze';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Gaze {
  private curX = 0;
  private curY = 0;
  private tgtX = 0;
  private tgtY = 0;

  /**
   * @param ease    per-step approach fraction (0..1). Higher = snappier.
   * @param maxLook largest eye offset in grid-pixels. Defaults to a half pixel
   *                so extreme cursor targets do not push the eyes outside the
   *                cat's side-facing head.
   */
  constructor(
    private readonly ease = 0.18,
    private readonly maxLook = 0.5,
  ) {}

  /** Set the gaze target; null returns the gaze to centre. */
  setTarget(target: GazeTarget | null): void {
    this.tgtX = target ? clamp(target.x, -1, 1) : 0;
    this.tgtY = target ? clamp(target.y, -1, 1) : 0;
  }

  /** Advance one step; returns rounded eye offsets in grid-pixels. */
  step(): { lookX: number; lookY: number } {
    this.curX += (this.tgtX - this.curX) * this.ease;
    this.curY += (this.tgtY - this.curY) * this.ease;
    const snap = (v: number) => Math.round(v * 2) / 2;
    return {
      lookX: snap(this.curX * this.maxLook),
      lookY: snap(this.curY * this.maxLook),
    };
  }
}
