import { describe, it, expect } from 'vitest';
import {
  VOICE_PACKS,
  DEFAULT_VOICE_ID,
  listVoicePacks,
  getVoicePack,
  resolveVoiceId,
  createVoiceSelection,
} from './voicePacks';

// Voice packs are roro's first monetizable COSMETIC (the cosmetics bridge): a free default voice + paid
// bundles, selectable at runtime, wired to the Kokoro engine's existing voiceId injectable. The catalog's
// tier metadata is the data the future store renders + the natural seam for entitlement gating.

describe('voicePacks catalog', () => {
  it('exposes af_heart as the FREE default', () => {
    expect(DEFAULT_VOICE_ID).toBe('af_heart');
    expect(getVoicePack(DEFAULT_VOICE_ID)?.tier).toBe('free');
  });

  it('has at least one PAID pack (the monetization hook)', () => {
    expect(listVoicePacks().some((p) => p.tier === 'paid')).toBe(true);
  });

  it('every pack has a unique id and complete metadata', () => {
    const ids = listVoicePacks().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // no dupes
    for (const p of VOICE_PACKS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(['free', 'paid']).toContain(p.tier);
      expect(['us', 'gb']).toContain(p.accent);
      expect(['f', 'm']).toContain(p.gender);
    }
  });
});

describe('resolveVoiceId — validate + fail-safe', () => {
  it('passes through a known voice id', () => {
    expect(resolveVoiceId('bm_george')).toBe('bm_george');
  });

  it('falls back to af_heart for unknown/empty/undefined (the cat is never voiceless)', () => {
    expect(resolveVoiceId('totally-made-up')).toBe('af_heart');
    expect(resolveVoiceId('')).toBe('af_heart');
    expect(resolveVoiceId(undefined)).toBe('af_heart');
  });
});

describe('createVoiceSelection — runtime switching', () => {
  it('defaults to af_heart and switches to a known voice', () => {
    const sel = createVoiceSelection();
    expect(sel.current()).toBe('af_heart');
    sel.set('bf_emma');
    expect(sel.current()).toBe('bf_emma');
  });

  it('resolves a bad INITIAL to the default', () => {
    expect(createVoiceSelection('garbage').current()).toBe('af_heart');
    expect(createVoiceSelection('bm_george').current()).toBe('bm_george');
  });

  it('IGNORES an unknown runtime set (keeps the current selection — a bad pick never silences the cat)', () => {
    const sel = createVoiceSelection('bm_george');
    sel.set('garbage');
    expect(sel.current()).toBe('bm_george'); // unchanged
    sel.set('bf_emma');
    expect(sel.current()).toBe('bf_emma');
  });
});
