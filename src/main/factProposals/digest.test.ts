import { describe, expect, it } from 'vitest';
import { createDigestAccumulator } from './digest';
import { DIGEST_CAPS } from './types';
import type { ActionEvent } from '../../shared/events';

const ts = 1;
const base = { runId: 'r1', sessionId: 's1', repo: '/r', agent: 'codex' as const, task: 'do x' };

describe('createDigestAccumulator — bounded, executor-emitted content only', () => {
  it('collects started commands, completed file changes (deduped), and messages', () => {
    const acc = createDigestAccumulator();
    const events: ActionEvent[] = [
      { kind: 'command', runId: 'r1', itemId: 'i1', status: 'started', command: 'npm test', ts },
      { kind: 'command', runId: 'r1', itemId: 'i1', status: 'completed', command: 'npm test', exitCode: 0, ts },
      { kind: 'file_change', runId: 'r1', itemId: 'i2', status: 'completed', files: [{ path: 'a.ts', op: 'update' }], ts },
      { kind: 'file_change', runId: 'r1', itemId: 'i2', status: 'completed', files: [{ path: 'a.ts', op: 'update' }], ts },
      { kind: 'message', runId: 'r1', text: 'done', ts },
    ];
    for (const e of events) acc.see(e);
    const d = acc.finish(base);
    expect(d.commands).toEqual(['npm test']); // started only — no double count from completion
    expect(d.files).toEqual([{ path: 'a.ts', op: 'update' }]); // deduped
    expect(d.messages).toEqual(['done']);
    expect(d.outcome).toBe('completed');
    expect(d.task).toBe('do x');
  });

  it('enforces every cap (counts and per-entry chars)', () => {
    const acc = createDigestAccumulator();
    for (let i = 0; i < DIGEST_CAPS.commands + 10; i++) {
      acc.see({ kind: 'command', runId: 'r1', itemId: `c${i}`, status: 'started', command: 'x'.repeat(DIGEST_CAPS.commandChars + 50), ts });
    }
    for (let i = 0; i < DIGEST_CAPS.messages + 5; i++) {
      acc.see({ kind: 'message', runId: 'r1', text: 'm'.repeat(DIGEST_CAPS.messageChars + 50), ts });
    }
    const d = acc.finish(base);
    expect(d.commands).toHaveLength(DIGEST_CAPS.commands);
    expect(d.commands[0]).toHaveLength(DIGEST_CAPS.commandChars);
    expect(d.messages).toHaveLength(DIGEST_CAPS.messages);
    expect(d.messages[0]).toHaveLength(DIGEST_CAPS.messageChars);
  });
});
