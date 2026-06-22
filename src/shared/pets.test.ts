import { describe, it, expect } from 'vitest';
import { PET_VARIANTS, getPet, defaultPet, resolvePet, isRoName } from './pets';

describe('pet variant catalog (the cosmetic -ro roster)', () => {
  it('is the -ro roster with Roro as the single default', () => {
    expect(PET_VARIANTS.map((p) => p.id)).toEqual(['roro', 'miro', 'sero', 'taro']);
    const defaults = PET_VARIANTS.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('roro');
  });

  it('every variant has a -ro name and a full hex palette', () => {
    for (const p of PET_VARIANTS) {
      expect(isRoName(p.id)).toBe(true);
      expect(p.palette.body).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.palette.eyes).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('getPet is case/space-insensitive; unknown -> undefined', () => {
    expect(getPet('  MiRo ')?.id).toBe('miro');
    expect(getPet('nope')).toBeUndefined();
  });

  it('defaultPet is Roro; resolvePet falls back to it', () => {
    expect(defaultPet().id).toBe('roro');
    expect(resolvePet('sero').id).toBe('sero');
    expect(resolvePet('unknown').id).toBe('roro');
    expect(resolvePet(null).id).toBe('roro');
    expect(resolvePet(undefined).id).toBe('roro');
  });

  it('isRoName enforces the -ro extensibility rule (a new character just needs a -ro name)', () => {
    expect(isRoName('taro')).toBe(true);
    expect(isRoName('Zaro')).toBe(true);
    expect(isRoName('fluffy')).toBe(false);
    expect(isRoName('ro')).toBe(false); // needs a prefix before 'ro'
    expect(isRoName('robot')).toBe(false);
  });
});
