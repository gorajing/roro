// src/renderer/voice/wireSpeechOutput.ts — route the assistant's committed message to local TTS (mouth).
//
// The cat "speaks" by rendering the EXISTING `message` ActionEvent through the local backend's speak()
// — no new event kind, no orchestrator change (mouth-not-brain). It only speaks while voice is SUMMONED:
// a typed turn (voice off) stays a silent on-screen peer (captions only). One-way: a TTS failure never
// disturbs the event stream. (message.delta sentence-streaming lands in Phase 3; Phase 0 speaks the final
// `message` text only.)

import type { ActionEvent } from '../../shared/events';

export interface SpeechOutputDeps {
  onActionEvent(cb: (e: ActionEvent) => void): () => void;
  /** Local TTS (the backend's speak). */
  speak(text: string): void | Promise<void>;
  /** True only while Voice Mode is summoned — gates spoken output off for typed turns. */
  isActive(): boolean;
}

export function wireSpeechOutput(deps: SpeechOutputDeps): () => void {
  return deps.onActionEvent((e) => {
    if (!deps.isActive()) return;
    if (e.kind === 'message' && e.text) {
      // Best-effort at the edge: a TTS failure must never break the event stream — swallow BOTH a sync
      // throw (the outer try) AND an async rejection (the .catch); speak() may be sync or return a Promise.
      try {
        void Promise.resolve(deps.speak(e.text)).catch(() => undefined);
      } catch {
        /* sync throw from speak() */
      }
    }
  });
}
