import { describe, it, expect, vi } from 'vitest';
import { createLocalVoiceBackend, type NativeVoiceEngine } from './voiceLocalAdapter';
import type { VoiceBackendEvents } from './voiceBackend';

const noopEvents: VoiceBackendEvents = { onSpeechStart() {}, onPartialTranscript() {}, onFinalTranscript() {} };

describe('createLocalVoiceBackend', () => {
  it('is unavailable by default (no native binaries detected) and fails loud on start', async () => {
    const backend = createLocalVoiceBackend();
    expect(backend.available).toBe(false);
    await expect(backend.start(noopEvents)).rejects.toThrow(/native|binaries|unavailable/i);
    // stop / setMuted are safe no-ops even when unavailable (teardown must never throw).
    await expect(backend.stop()).resolves.toBeUndefined();
    expect(() => backend.setMuted(true)).not.toThrow();
  });

  it('reflects the injected detection probe', () => {
    expect(createLocalVoiceBackend({ detect: () => true, engine: fakeEngine() }).available).toBe(true);
    expect(createLocalVoiceBackend({ detect: () => false }).available).toBe(false);
  });

  it('when available, delegates to the native engine and forwards its events to the backend caller', async () => {
    const engine = fakeEngine();
    const backend = createLocalVoiceBackend({ detect: () => true, engine });

    const onFinalTranscript = vi.fn();
    const onSpeechStart = vi.fn();
    await backend.start({ onSpeechStart, onPartialTranscript() {}, onFinalTranscript });
    expect(engine.start).toHaveBeenCalledOnce();

    // The engine drives the mic/VAD/STT; its emissions must reach the caller's handlers.
    engine.emit!.onSpeechStart();
    engine.emit!.onFinalTranscript('add a logout route');
    expect(onSpeechStart).toHaveBeenCalledOnce();
    expect(onFinalTranscript).toHaveBeenCalledWith('add a logout route');

    await backend.speak('done');
    expect(engine.speak).toHaveBeenCalledWith('done');
    backend.setMuted(true);
    expect(engine.setMuted).toHaveBeenCalledWith(true);
    await backend.stop();
    expect(engine.stop).toHaveBeenCalledOnce();
  });
});

/** A fake native engine that records calls and captures the emit handlers so a test can drive them. */
function fakeEngine(): NativeVoiceEngine & { emit?: VoiceBackendEvents; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; setMuted: ReturnType<typeof vi.fn> } {
  const engine = {
    emit: undefined as VoiceBackendEvents | undefined,
    start: vi.fn(async (emit: VoiceBackendEvents) => { engine.emit = emit; }),
    stop: vi.fn(async () => {}),
    speak: vi.fn(async () => {}),
    setMuted: vi.fn(() => {}),
  };
  return engine;
}
