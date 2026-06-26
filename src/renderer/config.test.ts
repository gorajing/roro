import { describe, expect, it } from 'vitest';
import { voiceSurfaceEnabled, type RoroConfig } from './config';

function config(overrides: Partial<RoroConfig> = {}): RoroConfig {
  return {
    modelUrl: '',
    floatingWindow: false,
    fakeVoice: false,
    vadVoice: false,
    sttVoice: false,
    ttsVoice: false,
    voicePack: '',
    cosmeticsStore: false,
    ...overrides,
  };
}

describe('voiceSurfaceEnabled', () => {
  it('keeps voice UI hidden for the default typed-only v0 launch', () => {
    expect(voiceSurfaceEnabled(config())).toBe(false);
  });

  it('reveals voice UI only when a scripted or real voice runtime is explicitly enabled', () => {
    expect(voiceSurfaceEnabled(config({ fakeVoice: true }))).toBe(true);
    expect(voiceSurfaceEnabled(config({ vadVoice: true }))).toBe(true);
    expect(voiceSurfaceEnabled(config({ sttVoice: true }))).toBe(true);
    expect(voiceSurfaceEnabled(config({ ttsVoice: true }))).toBe(true);
  });
});
