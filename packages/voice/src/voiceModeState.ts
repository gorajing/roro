// packages/voice/src/voiceModeState.ts — the Voice Mode lifecycle FSM (Phase D).
//
// Summon-never-always-on: voice is a deliberate Mode. This pure reducer tracks the UX-visible state
// that drives the tell (ear-perk on speech, "listening" caption, busy pose during a turn). It owns NO
// audio + NO DOM — createVoiceMode (voiceMode.ts) feeds it backend/turn events and renders the result.

export type VoiceMode = 'off' | 'listening' | 'hearing' | 'working';

export interface VoiceModeState {
  /** off = not summoned; listening = mic open, waiting; hearing = user speaking; working = turn running. */
  mode: VoiceMode;
  /** Hard demo/presentation mute (committed utterances are dropped before turnRun). */
  muted: boolean;
}

export const INITIAL_VOICE_MODE_STATE: VoiceModeState = { mode: 'off', muted: false };

export type VoiceModeEvent =
  | { type: 'summon' }
  | { type: 'unsummon' }
  | { type: 'speechStart' }
  | { type: 'turnStarted' }
  | { type: 'turnEnded' }
  | { type: 'setMuted'; muted: boolean };

export function reduceVoiceMode(state: VoiceModeState, event: VoiceModeEvent): VoiceModeState {
  switch (event.type) {
    case 'setMuted':
      return { ...state, muted: event.muted };
    case 'unsummon':
      return { ...state, mode: 'off' };
    case 'summon':
      // Idempotent: re-summoning while already open keeps the current mode.
      return state.mode === 'off' ? { ...state, mode: 'listening' } : state;
    case 'speechStart':
      // Only meaningful while the mic is open. Mid-turn (working) it's a barge-in — the router handles
      // the preempt; the visible mode stays 'working'.
      return state.mode === 'listening' ? { ...state, mode: 'hearing' } : state;
    case 'turnStarted':
      return state.mode === 'off' ? state : { ...state, mode: 'working' };
    case 'turnEnded':
      // The turn ended but we're still summoned → back to listening.
      return state.mode === 'off' ? state : { ...state, mode: 'listening' };
  }
}
