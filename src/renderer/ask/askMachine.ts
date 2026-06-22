// src/renderer/ask/askMachine.ts — the PURE state machine for the floating Ask surface.
//
// The collapsed "Ask Roro…" pill IS the summon handle; expanded is the focused input; tasked is the
// "tasked: …" pill shown while a run is live. All DOM/driver/turnRun work is returned as EFFECTS
// (data) and performed by the shell (floatingAsk.ts) — so every transition rule is unit-testable.

export type AskState = 'collapsed' | 'expanded' | 'tasked';

export type AskEvent =
  | { type: 'summon' }
  | { type: 'dismiss' } // Esc
  | { type: 'submit'; text: string }
  | { type: 'runStarted' }
  | { type: 'runEnded' };

export type AskEffect =
  | { type: 'focusInput' }
  | { type: 'poke' }
  | { type: 'setThinkingPose' }
  | { type: 'startTurn'; text: string }
  | { type: 'showTasked'; text: string }
  | { type: 'armStop' }
  | { type: 'disarmStop' }
  | { type: 'collapse' };

export interface AskResult {
  state: AskState;
  effects: AskEffect[];
}

export const INITIAL_ASK_STATE: AskState = 'collapsed';

const noop = (state: AskState): AskResult => ({ state, effects: [] });

export function askReduce(state: AskState, event: AskEvent): AskResult {
  switch (event.type) {
    case 'summon':
      // Collapsed pill click / ⌘⇧Space-when-hidden → open + wake the cat. Already-open is a no-op
      // (the window-level hide-on-resummon is the shell's concern, not the surface state).
      return state === 'collapsed'
        ? { state: 'expanded', effects: [{ type: 'focusInput' }, { type: 'poke' }] }
        : noop(state);

    case 'dismiss':
      return state === 'expanded'
        ? { state: 'collapsed', effects: [{ type: 'collapse' }] }
        : noop(state);

    case 'submit': {
      if (state !== 'expanded') return noop(state); // one turn at a time (tasked) / not open (collapsed)
      const text = event.text.trim();
      if (!text) return noop(state); // empty Enter: checked BEFORE any pose so it never flashes thinking
      return {
        state: 'tasked',
        // Pose FIRST so the shell sets it synchronously before awaiting turnRun (≤16ms budget).
        effects: [{ type: 'setThinkingPose' }, { type: 'startTurn', text }, { type: 'showTasked', text }],
      };
    }

    case 'runStarted':
      return state === 'tasked' ? { state, effects: [{ type: 'armStop' }] } : noop(state);

    case 'runEnded':
      return state === 'tasked'
        ? { state: 'collapsed', effects: [{ type: 'disarmStop' }, { type: 'collapse' }] }
        : noop(state);
  }
}
