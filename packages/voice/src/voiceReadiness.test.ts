import { describe, it, expect } from 'vitest';
import { voiceReadiness } from './voiceReadiness';

// The Voice Mode readiness probe aggregates the three preconditions the on-device path needs (mic, staged
// weights, local brain) into ONE fail-loud verdict — so clicking "Voice Mode" either starts cleanly or tells
// the user EXACTLY what's missing. Pure: the IO (mic status / weights HEAD / brain preflight) is injected.

const OK = { mic: 'granted', sttWeightsPresent: true, ttsWeightsPresent: true, want: { stt: true, tts: true } } as const;

describe('voiceReadiness', () => {
  it('is ready when mic granted, both weights staged, brain up (full voice)', () => {
    const r = voiceReadiness(OK);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('blocks on a DENIED mic with Settings guidance (cannot re-prompt)', () => {
    const r = voiceReadiness({ ...OK, mic: 'denied' });
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => /System Settings/i.test(b))).toBe(true);
  });

  it('does NOT block on a not-determined mic — starting Voice Mode triggers the consent prompt', () => {
    const r = voiceReadiness({ ...OK, mic: 'not-determined' });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('does NOT block on an unknown mic status — activation prompts and reports if still not granted', () => {
    const r = voiceReadiness({ ...OK, mic: 'unknown' });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('blocks on missing STT weights ONLY when STT is wanted, with the stage command', () => {
    expect(voiceReadiness({ ...OK, sttWeightsPresent: false }).ready).toBe(false);
    expect(voiceReadiness({ ...OK, sttWeightsPresent: false }).blockers.some((b) => /stage:voice-assets/.test(b))).toBe(true);
    // STT not wanted (e.g. a speak-only mode) → missing STT weights is irrelevant.
    expect(voiceReadiness({ ...OK, sttWeightsPresent: false, want: { stt: false, tts: true } }).ready).toBe(true);
  });

  it('blocks on missing TTS weights ONLY when TTS is wanted', () => {
    expect(voiceReadiness({ ...OK, ttsWeightsPresent: false }).ready).toBe(false);
    expect(voiceReadiness({ ...OK, ttsWeightsPresent: false, want: { stt: true, tts: false } }).ready).toBe(true);
  });

  it('reports EVERY blocker at once (not just the first) so the user fixes them in one pass', () => {
    const r = voiceReadiness({ mic: 'denied', sttWeightsPresent: false, ttsWeightsPresent: false, want: { stt: true, tts: true } });
    expect(r.ready).toBe(false);
    expect(r.blockers.length).toBe(3); // denied mic + missing STT + missing TTS
  });
});
