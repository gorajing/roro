import { describe, it, expect } from 'vitest';
import { derivePetState, type PetStateInput } from './petState';

// A calm, awake baseline; each test overrides only the axis it exercises.
const base: PetStateInput = {
  avatarState: 'idle',
  energy: 'awake',
  cursorTracked: false,
  listening: false,
  recentlyPetted: false,
};
const input = (over: Partial<PetStateInput>): PetStateInput => ({ ...base, ...over });

describe('derivePetState — mood', () => {
  it('idle + awake + untouched reads as curious', () => {
    expect(derivePetState(base).mood).toBe('curious');
  });

  it('a failed run reads as worried', () => {
    expect(derivePetState(input({ avatarState: 'error' })).mood).toBe('worried');
  });

  it('a completed run reads as proud', () => {
    expect(derivePetState(input({ avatarState: 'done' })).mood).toBe('proud');
  });

  it('working / thinking reads as focused', () => {
    expect(derivePetState(input({ avatarState: 'working' })).mood).toBe('focused');
    expect(derivePetState(input({ avatarState: 'thinking' })).mood).toBe('focused');
  });

  it('a fresh pet reads as playful', () => {
    expect(derivePetState(input({ recentlyPetted: true })).mood).toBe('playful');
  });

  it('drowsy or asleep (when idle) reads as sleepy', () => {
    expect(derivePetState(input({ energy: 'drowsy' })).mood).toBe('sleepy');
    expect(derivePetState(input({ energy: 'asleep' })).mood).toBe('sleepy');
  });
});

describe('derivePetState — mood priority', () => {
  it('active agent states beat idle-energy: working while asleep-energy still reads focused', () => {
    expect(derivePetState(input({ avatarState: 'working', energy: 'asleep' })).mood).toBe('focused');
  });

  it('distress beats everything: error while recently petted still reads worried', () => {
    expect(derivePetState(input({ avatarState: 'error', recentlyPetted: true })).mood).toBe('worried');
  });

  it('a fresh pet beats idle rest: petted while drowsy reads playful, not sleepy', () => {
    expect(derivePetState(input({ recentlyPetted: true, energy: 'drowsy' })).mood).toBe('playful');
  });
});

describe('derivePetState — attention', () => {
  it('working / thinking → working', () => {
    expect(derivePetState(input({ avatarState: 'working' })).attention).toBe('working');
    expect(derivePetState(input({ avatarState: 'thinking' })).attention).toBe('working');
  });

  it('listening (state or signal) → listening', () => {
    expect(derivePetState(input({ avatarState: 'listening' })).attention).toBe('listening');
    expect(derivePetState(input({ listening: true })).attention).toBe('listening');
  });

  it('cursor tracking → watching-cursor', () => {
    expect(derivePetState(input({ cursorTracked: true })).attention).toBe('watching-cursor');
  });

  it('nothing notable → idle', () => {
    expect(derivePetState(base).attention).toBe('idle');
  });

  it('active work outranks cursor tracking', () => {
    expect(derivePetState(input({ avatarState: 'working', cursorTracked: true })).attention).toBe('working');
  });
});

describe('derivePetState — energy passthrough & null state', () => {
  it('energy passes through unchanged on every axis combination', () => {
    expect(derivePetState(input({ energy: 'drowsy' })).energy).toBe('drowsy');
    expect(derivePetState(input({ energy: 'asleep', avatarState: 'working' })).energy).toBe('asleep');
  });

  it('a null avatarState (pre-first-event) reads as calm idle/curious', () => {
    const s = derivePetState(input({ avatarState: null }));
    expect(s.mood).toBe('curious');
    expect(s.attention).toBe('idle');
  });
});
