import { describe, it, expect } from 'vitest';
import { petExpression, NEUTRAL_EXPRESSION } from './petExpression';
import type { PetState } from './petState';

const MOODS: PetState['mood'][] = ['playful', 'proud', 'curious', 'focused', 'worried', 'sleepy'];
const withMood = (mood: PetState['mood']): PetState => ({ mood, energy: 'awake', attention: 'idle' });

describe('petExpression', () => {
  it('curious is the neutral baseline (behavior-preserving for the resting cat)', () => {
    expect(petExpression(withMood('curious'))).toEqual(NEUTRAL_EXPRESSION);
    expect(petExpression(withMood('curious')).tailWagPeriod).toBe(24);
  });

  it('playful and proud wag faster than neutral', () => {
    expect(petExpression(withMood('playful')).tailWagPeriod).toBeLessThan(24);
    expect(petExpression(withMood('proud')).tailWagPeriod).toBeLessThan(24);
  });

  it('focused, worried, and sleepy wag slower than neutral', () => {
    expect(petExpression(withMood('focused')).tailWagPeriod).toBeGreaterThan(24);
    expect(petExpression(withMood('worried')).tailWagPeriod).toBeGreaterThan(24);
    expect(petExpression(withMood('sleepy')).tailWagPeriod).toBeGreaterThan(24);
  });

  it('sleepy is the slowest wag of all moods', () => {
    const sleepy = petExpression(withMood('sleepy')).tailWagPeriod;
    for (const m of MOODS) {
      expect(petExpression(withMood(m)).tailWagPeriod).toBeLessThanOrEqual(sleepy);
    }
  });

  it('every period is a positive number (safe as a divisor)', () => {
    for (const m of MOODS) {
      expect(petExpression(withMood(m)).tailWagPeriod).toBeGreaterThan(0);
    }
  });

  it('energy and attention do not affect the result (mood-only for now)', () => {
    const a: PetState = { mood: 'playful', energy: 'awake', attention: 'idle' };
    const b: PetState = { mood: 'playful', energy: 'asleep', attention: 'working' };
    expect(petExpression(a)).toEqual(petExpression(b));
  });
});
