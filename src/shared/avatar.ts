// src/shared/avatar.ts — the 6 avatar states + the ONE mapper the renderer uses.
// No other component invents states; the renderer drives the character off eventToAvatarState() only.
import type { ActionEvent } from './events';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'error';

export function eventToAvatarState(e: ActionEvent): AvatarState | null {
  switch (e.kind) {
    case 'reasoning':
      return 'thinking';
    case 'command':
    case 'file_change':
    case 'tool':
      // A failed command/tool mid-run is usually an EXPECTED intermediate failure
      // (e.g. a red test shown before the fix, or an exploratory command that
      // errors) — the run is still going, so stay 'working'. Only a terminal
      // run.failed means the job actually failed.
      return 'working';
    case 'run.completed':
      return 'done';
    case 'run.failed':
      return 'error';
    case 'run.started':
    case 'turn.started':
      return 'working';
    case 'message':
    case 'message.delta':
    case 'status':
      return null; // final/streaming assistant text + status beats don't change avatar state
    default: {
      // Exhaustiveness: adding an ActionEvent kind must be a DELIBERATE avatar-state decision, not a
      // silent fall-through. The never-assignment fails the build until the new kind is handled above.
      const _exhaustive: never = e;
      return _exhaustive ?? null;
    }
  }
}
