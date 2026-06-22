import { describe, it, expect } from 'vitest';
import { decideSummonAction } from './summon';

describe('decideSummonAction', () => {
  it('hides when the window is already visible AND focused (don\'t wake a cat you\'re dismissing)', () => {
    expect(decideSummonAction({ visible: true, focused: true, floating: true })).toBe('hide');
    expect(decideSummonAction({ visible: true, focused: true, floating: false })).toBe('hide');
  });

  it('shows + focuses the Ask in floating mode when hidden or unfocused', () => {
    expect(decideSummonAction({ visible: false, focused: false, floating: true })).toBe('show-and-focus-ask');
    expect(decideSummonAction({ visible: true, focused: false, floating: true })).toBe('show-and-focus-ask');
  });

  it('plain show (no Ask focus) in non-floating dev mode', () => {
    expect(decideSummonAction({ visible: false, focused: false, floating: false })).toBe('show');
  });
});
