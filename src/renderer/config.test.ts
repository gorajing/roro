import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, voiceSurfaceEnabled, type RoroConfig } from './config';

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
    debugBridge: false,
    floatingSmoke: false,
    memoryPanelSmoke: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('loadConfig', () => {
  it('keeps the debug bridge off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().debugBridge).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { debugBridge: true } });

    expect(loadConfig().debugBridge).toBe(true);
  });

  it('keeps the floating smoke harness off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().floatingSmoke).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { floatingSmoke: true } });

    expect(loadConfig().floatingSmoke).toBe(true);
  });

  it('keeps the Memory panel smoke harness off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().memoryPanelSmoke).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { memoryPanelSmoke: true } });

    expect(loadConfig().memoryPanelSmoke).toBe(true);
  });
});
