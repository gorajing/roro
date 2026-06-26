import { describe, it, expect } from 'vitest';
import { voiceMicNeeded, voiceRuntimeEnabled } from './voiceFlags';

describe('voiceRuntimeEnabled — gate v0 voice surfaces on explicit dev flags', () => {
  it('is false on a default typed-only launch', () => {
    expect(voiceRuntimeEnabled({})).toBe(false);
  });

  it('is true for the scripted fake voice and each real on-device voice flag', () => {
    expect(voiceRuntimeEnabled({ RORO_FAKE_VOICE: '1' })).toBe(true);
    expect(voiceRuntimeEnabled({ RORO_VAD_VOICE: '1' })).toBe(true);
    expect(voiceRuntimeEnabled({ RORO_STT_VOICE: '1' })).toBe(true);
    expect(voiceRuntimeEnabled({ RORO_TTS_VOICE: '1' })).toBe(true);
  });

  it('treats only "1" as enabled', () => {
    expect(voiceRuntimeEnabled({ RORO_FAKE_VOICE: 'true' })).toBe(false);
    expect(voiceRuntimeEnabled({ RORO_STT_VOICE: '0' })).toBe(false);
    expect(voiceRuntimeEnabled({ RORO_VAD_VOICE: '' })).toBe(false);
  });
});

describe('voiceMicNeeded — gate macOS mic consent on the on-device voice flags', () => {
  it('is false on a default (typed-only) launch — so it never prompts for the mic', () => {
    expect(voiceMicNeeded({})).toBe(false);
  });

  it('is false when only the scripted FAKE engine is enabled (no real mic is opened)', () => {
    expect(voiceMicNeeded({ RORO_FAKE_VOICE: '1' })).toBe(false);
  });

  it('is true for VAD / STT / TTS — each composes the Silero mic ear', () => {
    expect(voiceMicNeeded({ RORO_VAD_VOICE: '1' })).toBe(true);
    expect(voiceMicNeeded({ RORO_STT_VOICE: '1' })).toBe(true);
    expect(voiceMicNeeded({ RORO_TTS_VOICE: '1' })).toBe(true);
  });

  it('treats only "1" as enabled (matching window.ts), not "0"/"true"/empty', () => {
    expect(voiceMicNeeded({ RORO_STT_VOICE: '0' })).toBe(false);
    expect(voiceMicNeeded({ RORO_VAD_VOICE: 'true' })).toBe(false);
    expect(voiceMicNeeded({ RORO_TTS_VOICE: '' })).toBe(false);
  });
});
