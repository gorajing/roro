// src/main/factProposals/digest.ts — accumulate a bounded RunDigest from the run's own event stream.
//
// Fed from the pump's emit sink in startPump (no stream fork, no second consumer). Caps
// bound both memory and the proposal prompt's size; content is ONLY what the executor itself
// emitted (plus the dispatched task, added at finish()) — see types.ts's privacy invariant.

import type { ActionEvent, AgentKind } from '../../shared/events';
import { DIGEST_CAPS, type RunDigest } from './types';

export interface DigestAccumulator {
  see(ev: ActionEvent): void;
  finish(base: { runId: string; sessionId: string; repo: string; agent: AgentKind; task: string; finalText?: string }): RunDigest;
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export function createDigestAccumulator(): DigestAccumulator {
  const commands: string[] = [];
  const files: RunDigest['files'] = [];
  const seenFiles = new Set<string>();
  const messages: string[] = [];

  return {
    see(ev) {
      if (ev.kind === 'command' && ev.status === 'started' && commands.length < DIGEST_CAPS.commands) {
        commands.push(clip(ev.command, DIGEST_CAPS.commandChars));
      } else if (ev.kind === 'file_change' && ev.status === 'completed' && files.length < DIGEST_CAPS.files) {
        for (const f of ev.files) {
          const key = `${f.op}:${f.path}`;
          if (seenFiles.has(key) || files.length >= DIGEST_CAPS.files) continue;
          seenFiles.add(key);
          files.push({ path: f.path, op: f.op });
        }
      } else if (ev.kind === 'message' && messages.length < DIGEST_CAPS.messages) {
        messages.push(clip(ev.text, DIGEST_CAPS.messageChars));
      }
    },
    finish(base) {
      return { ...base, outcome: 'completed', commands: [...commands], files: [...files], messages: [...messages] };
    },
  };
}
