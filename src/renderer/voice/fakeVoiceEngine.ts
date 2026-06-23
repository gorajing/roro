// src/renderer/voice/fakeVoiceEngine.ts — a scripted NativeVoiceEngine for dev + tests (no audio).
//
// Lets the WHOLE local voice path be exercised end-to-end — the cat's ears perk (onSpeechStart), a
// committed utterance routes through turnRun (mouth-not-brain), and the cat "speaks" (speak() records) —
// without whisper.cpp / Silero / Kokoro or a microphone. `utter()` drives a committed utterance on
// demand; an optional script auto-emits on a timer (a dev-flag "fake voice mode"). The real engine
// (Phases 1-3) replaces this behind the unchanged NativeVoiceEngine interface.

import type { NativeVoiceEngine } from './voiceLocalAdapter';
import type { VoiceBackendEvents } from './voiceBackend';

export interface FakeVoiceEngine extends NativeVoiceEngine {
  /** Drive a committed utterance now (ear-perk -> partial -> final). No-op before start(). */
  utter(text: string): void;
  /** Everything speak() was asked to say, in order. */
  readonly spoken: string[];
  readonly muted: boolean;
}

export function createFakeVoiceEngine(opts: { script?: string[]; intervalMs?: number } = {}): FakeVoiceEngine {
  let emit: VoiceBackendEvents | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const spoken: string[] = [];
  let muted = false;

  function utter(text: string): void {
    if (!emit) return; // not started -> nothing to drive
    emit.onSpeechStart();
    emit.onPartialTranscript(text);
    emit.onFinalTranscript(text);
  }

  return {
    spoken,
    get muted() { return muted; },
    utter,
    async start(events: VoiceBackendEvents): Promise<void> {
      emit = events;
      const script = opts.script ?? [];
      if (script.length > 0) {
        let i = 0;
        timer = setInterval(() => {
          if (i >= script.length) { if (timer) clearInterval(timer); return; }
          utter(script[i++]);
        }, opts.intervalMs ?? 2500);
      }
    },
    async stop(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = undefined;
      emit = undefined;
    },
    async speak(text: string): Promise<void> {
      spoken.push(text);
    },
    setMuted(m: boolean): void {
      muted = m;
    },
  };
}
