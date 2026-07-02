import { readFileSync } from 'node:fs';
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

// Drift guard: the build-time staging script (scripts/stage-voice-assets.mjs) hardcodes which voice .bin
// matrices to download into public/models/. Because the renderer loads voices SAME-ORIGIN with
// allowRemoteModels=false (M3), a catalog voice whose .bin was never staged would 404 + silence that voice
// at runtime. This couples the two lists; the test fails loud the moment they drift apart.
describe('voicePacks ↔ staging-script drift guard', () => {
  it('stage-voice-assets.mjs stages EXACTLY the VOICE_PACKS ids (add a new voice to both, or neither)', () => {
    const script = readFileSync('scripts/stage-voice-assets.mjs', 'utf8');
    const m = script.match(/keepVoices:\s*\[([^\]]*)\]\.map/); // the `keepVoices: [ '…', … ].map(…)` literal
    if (!m) throw new Error('keepVoices id array literal not found in stage-voice-assets.mjs (did its shape change?)');
    const stagedIds = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    const catalogIds = VOICE_PACKS.map((p) => p.id).sort();
    expect(stagedIds).toEqual(catalogIds);
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
