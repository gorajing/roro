import { describe, it, expect } from 'vitest';
import { captureForLocateRequest } from './locateGate';

const at = (transcript: string, screen?: string) => captureForLocateRequest({ transcript, memory: undefined, screen });

describe('captureForLocateRequest — deterministic capture_screen routing for pointing intents', () => {
  it('routes clear on-screen locate/point requests to capture_screen', () => {
    for (const q of [
      'point at the save button',
      'point to the red close button',
      'show me where the settings menu is',
      'look at my screen and point at the apple menu logo in the top-left',
      'where is the merge button',
      'where are the tabs on the screen',
      'on my screen, which icon opens settings',
    ]) {
      const d = at(q);
      expect(d, q).not.toBeNull();
      expect(d!.command, q).toBe('capture_screen');
    }
  });

  it('does NOT route pure coding/referent requests to capture_screen', () => {
    for (const q of [
      'add a health check endpoint to my api',
      'fix the bug in calc.py',
      'point out the typo in the readme', // "point out" = identify, not a screen point
      'where is the config loaded',       // no UI noun, no screen reference
      'refactor the auth module',
    ]) {
      expect(at(q), q).toBeNull();
    }
  });

  it('stands down once the screen has already been captured (no infinite capture loop)', () => {
    expect(at('point at the save button', 'a screenshot description of the screen')).toBeNull();
  });

  it('returns a spoken narration and marks the turn as a locate (args.locate)', () => {
    const d = at('point at the toolbar');
    expect(d!.narration).toBe('Let me look at your screen.');
    expect(d!.args).toEqual({ locate: true });
  });
});
