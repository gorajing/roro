// src/main/summon.ts — the pure ⌘⇧Space decision (extracted from window.ts so it's testable).
// Visible+focused → hide (a re-summon on a focused cat dismisses it, and must NOT poke/refocus).
// Otherwise show; in floating mode also focus the Ask input (CH.focusAsk) and poke the cat.

export interface SummonWindowState {
  visible: boolean;
  focused: boolean;
  floating: boolean;
}

export type SummonAction = 'hide' | 'show-and-focus-ask' | 'show';

export function decideSummonAction(s: SummonWindowState): SummonAction {
  if (s.visible && s.focused) return 'hide';
  return s.floating ? 'show-and-focus-ask' : 'show';
}
