// src/renderer/voice/voiceMode.ts — the local-voice integration core (Phase D).
//
// Wires a VoiceBackend (voiceLocalAdapter, or the stub) to the CANONICAL voiceTurnRouter — the SAME
// turn-manager the Vapi path uses (wireEvents.ts) — so the local path enforces mouth-not-brain
// (committed utterance -> turnRun) and C1 barge-in identically. It drives the ear-perk tell off VAD and
// advances the Voice Mode FSM (voiceModeState). No audio + no DOM here: summon()/unsummon() open/close
// the injected backend; bootstrap mounts the UI + picks the backend (local when available, else Vapi).

import { makeVoiceTurnRouter, type VoiceTurnDeps } from './voiceTurnRouter';
import { reduceVoiceMode, INITIAL_VOICE_MODE_STATE, type VoiceModeState, type VoiceModeEvent } from './voiceModeState';
import type { VoiceBackend, VoiceBackendEvents } from './voiceBackend';
import type { CharacterDriver, CaptionSink } from '../character/types';

export interface VoiceModeDeps extends VoiceTurnDeps {
  /** Subscribe to the universal runEnd (window.companion.onRunEnd) so the router + FSM advance. Returns an
   *  unsubscribe so dispose() can detach it — else a leaked runEnd could drain the router after teardown. */
  onRunEnd(cb: (runId?: string) => void): () => void;
}

export interface CreateVoiceModeOptions {
  backend: VoiceBackend;
  deps: VoiceModeDeps;
  driver: Pick<CharacterDriver, 'poke'>;
  captions?: CaptionSink;
  /** Notified on every FSM transition so the UI can render the tell. */
  onState?: (state: VoiceModeState) => void;
  /** Hard demo/presentation mute — a muted committed utterance never reaches turnRun. */
  isMuted?: () => boolean;
}

export interface VoiceMode {
  /** Open the mic (deliberate Mode). */
  summon(): Promise<void>;
  /** Close the mic + reset to off. */
  unsummon(): Promise<void>;
  /** Tear down for good: detach the runEnd subscription + release the backend. After dispose(), a late
   *  runEnd can no longer drain the router. */
  dispose(): void;
  readonly available: boolean;
  readonly state: VoiceModeState;
}

export function createVoiceMode(opts: CreateVoiceModeOptions): VoiceMode {
  const { backend, deps, driver, captions, onState, isMuted } = opts;
  let state = INITIAL_VOICE_MODE_STATE;

  const router = makeVoiceTurnRouter({
    turnRun: deps.turnRun,
    cancelTask: deps.cancelTask,
    isRunActive: deps.isRunActive,
  });

  function apply(event: VoiceModeEvent): void {
    state = reduceVoiceMode(state, event);
    onState?.(state);
  }

  // A lifecycle epoch guards summon()'s async window: backend.start() can take a while (model load). If
  // unsummon() (or a re-summon) runs during that load, the late start() must NOT flip the visible mode
  // back to 'listening' after teardown. unsummon() + summon() each bump the epoch; summon only applies
  // its FSM transition if its epoch is still current. (The engine's own generation token discards the
  // late backend itself — this guards the FSM state.)
  let lifecycleEpoch = 0;

  // Route the universal runEnd through the router (so ONLY this router's run advances its queue) and
  // reflect the end in the visible mode. Keep the unsubscribe so dispose() can detach it.
  const offRunEnd = deps.onRunEnd((runId) => {
    router.onRunEnd(runId);
    apply({ type: 'turnEnded' });
  });

  const events: VoiceBackendEvents = {
    onSpeechStart() {
      driver.poke?.(); // ear-perk: the <=80ms local "I heard you", before any STT result
      apply({ type: 'speechStart' });
    },
    onPartialTranscript(text: string) {
      captions?.update('user', text, false); // live caption tell; NOT routed (mouth-not-brain)
    },
    onFinalTranscript(text: string) {
      // Hard mute gate BEFORE the router: a muted committed utterance never reaches turnRun.
      if (isMuted?.()) {
        apply({ type: 'turnEnded' }); // drop it, fall back to listening
        return;
      }
      router.onFinalTranscript(text);
      apply({ type: 'turnStarted' });
    },
  };

  return {
    get available() {
      return backend.available;
    },
    get state() {
      return state;
    },
    async summon() {
      const epoch = ++lifecycleEpoch;
      await backend.start(events);
      if (epoch === lifecycleEpoch) apply({ type: 'summon' }); // not superseded by an unsummon/re-summon during load
    },
    async unsummon() {
      lifecycleEpoch++; // invalidate any in-flight summon()
      await backend.stop();
      apply({ type: 'unsummon' });
    },
    dispose() {
      lifecycleEpoch++; // invalidate any in-flight summon() (like unsummon) so a late start() can't resurrect the FSM
      offRunEnd(); // detach the runEnd handler FIRST so it can't drain the router after teardown
      void backend.stop().catch(() => undefined); // teardown is best-effort: a native stop failure must not reject
    },
  };
}
