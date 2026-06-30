import { describe, it, expect } from 'vitest';
import { resolveSoul, defaultSoul } from './souls';

describe('souls catalog', () => {
  it('the default soul is the flagship cat, which has a renderer', () => {
    const soul = defaultSoul();
    expect(soul.id).toBe('roro');
    expect(soul.species).toBe('cat');
    expect(soul.hasRenderer).toBe(true);
  });

  it('Miro is the dog soul (per COMPANION-ARCHITECTURE), with art still pending', () => {
    const soul = resolveSoul('miro');
    expect(soul.id).toBe('miro');
    expect(soul.name).toBe('Miro');
    expect(soul.species).toBe('dog');
    expect(soul.hasRenderer).toBe(false); // honest: no distinct dog renderer yet
  });

  it('other roster cats resolve as cat souls with a renderer', () => {
    expect(resolveSoul('sero')).toMatchObject({ id: 'sero', species: 'cat', hasRenderer: true });
    expect(resolveSoul('taro')).toMatchObject({ id: 'taro', species: 'cat', hasRenderer: true });
  });

  it('unknown / empty ids fall back to the default soul', () => {
    expect(resolveSoul('not-a-soul').id).toBe('roro');
    expect(resolveSoul(null).id).toBe('roro');
    expect(resolveSoul(undefined).id).toBe('roro');
  });

  it('only renderable souls would be offered (the dog is filtered until it has art)', () => {
    const candidates = ['roro', 'miro'].map(resolveSoul).filter((s) => s.hasRenderer);
    expect(candidates.map((s) => s.id)).toEqual(['roro']);
  });
});
