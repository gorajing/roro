// src/renderer/voice/mountLocalVoiceMode.ts — compose the on-device voice path (the Phase-0 glue).
//
// Wires the local backend (an injected NativeVoiceEngine behind the fail-loud `available` gate) through
// createVoiceMode (INPUT: committed utterance -> turnRun, mouth-not-brain + ear-perk + FSM) and
// wireSpeechOutput (OUTPUT: the assistant's `message` -> backend.speak()). Returns the VoiceMode + a
// dispose. When no engine is present (`available` false) the mode is inert and bootstrap falls back to
// the Vapi facade / stub — so this never regresses the existing path. Testable end-to-end with a fake
// engine; the real whisper/Silero/Kokoro engine slots in (Phases 1-3) behind the unchanged interface.

import { createLocalVoiceBackend, type NativeVoiceEngine } from './voiceLocalAdapter';
import { createVoiceMode, type VoiceMode, type VoiceModeDeps } from './voiceMode';
import { wireSpeechOutput } from './wireSpeechOutput';
import type { ActionEvent } from '../../shared/events';
import type { CharacterDriver, CaptionSink } from '../character/types';
import type { VoiceModeState } from './voiceModeState';

export interface MountLocalVoiceOptions {
  /** The native engine (whisper/Silero/Kokoro); absent on hardware-less / typed-only tiers. */
  engine?: NativeVoiceEngine;
  /** Probe for the engine + mic. Defaults to false (no local voice). */
  detect?: () => boolean;
  deps: VoiceModeDeps;
  onActionEvent(cb: (e: ActionEvent) => void): () => void;
  driver: Pick<CharacterDriver, 'poke'>;
  captions?: CaptionSink;
  onState?: (state: VoiceModeState) => void;
  isMuted?: () => boolean;
}

export interface LocalVoice {
  mode: VoiceMode;
  /** True when the on-device backend is available (engine + mic). */
  readonly available: boolean;
  dispose(): void;
}

export function mountLocalVoiceMode(opts: MountLocalVoiceOptions): LocalVoice {
  const backend = createLocalVoiceBackend({ detect: opts.detect, engine: opts.engine });
  const mode = createVoiceMode({
    backend,
    deps: opts.deps,
    driver: opts.driver,
    captions: opts.captions,
    onState: opts.onState,
    isMuted: opts.isMuted,
  });
  // The mouth: speak the assistant's committed message via local TTS, but only while summoned.
  const unsubSpeech = wireSpeechOutput({
    onActionEvent: opts.onActionEvent,
    speak: (text) => backend.speak(text),
    isActive: () => mode.state.mode !== 'off',
  });
  return {
    mode,
    available: backend.available,
    dispose(): void {
      unsubSpeech();
      mode.dispose(); // detaches onRunEnd + releases the backend (no late runEnd can drain the router)
    },
  };
}
