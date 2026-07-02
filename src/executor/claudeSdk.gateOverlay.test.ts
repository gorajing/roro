import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ActionEvent, ExecutorRunOptions } from '../shared/events';
import type { DestructiveGate } from './claudeSdkGate';

// The runtime gate overlay of runClaudeSdk — deterministically, with a MOCKED SDK query (no live
// CLI). Proves the Bash deferral: a destructive command's `command`/started is emitted only after
// the gate clears it; a denied command becomes a `status` beat with NO command event and its
// completion is suppressed; a denied command that EXECUTES anyway trips the bypass wire; and abort
// (instanceof AbortError) yields nothing.

class FakeAbortError extends Error {
  constructor() {
    super('Claude Code process aborted by user');
    this.name = 'Error'; // mirrors the real minified class (probe P3): name is NOT 'AbortError'
  }
}

// The scripted message stream the fake query yields. Set per-test before importing runClaudeSdk.
let SCRIPT: unknown[] = [];
let THROW_AFTER: number | null = null; // index after which the stream throws FakeAbortError

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  AbortError: FakeAbortError,
  query: () => ({
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < SCRIPT.length; i += 1) {
        yield SCRIPT[i];
        if (THROW_AFTER !== null && i === THROW_AFTER) throw new FakeAbortError();
      }
    },
  }),
}));

import { runClaudeSdk } from './claudeSdk';

function gateFor(decision: 'approve' | 'deny'): { gate: DestructiveGate; ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async () => decision === 'approve');
  const gate: DestructiveGate = {
    classify: (command) => (command.includes('rm -rf') ? { destructive: true, reason: 'rm -r' } : { destructive: false }),
    ask,
    onCleared: vi.fn(),
  };
  return { gate, ask };
}

async function drain(opts: ExecutorRunOptions): Promise<ActionEvent[]> {
  const out: ActionEvent[] = [];
  for await (const ev of runClaudeSdk(opts)) out.push(ev);
  return out;
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sess_x' };
const bashStarted = (id: string, command: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
});
const toolResult = (id: string, isError: boolean, content = 'out') => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
});
const RESULT_OK = { type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 1 } };

describe('runClaudeSdk — runtime destructive-gate overlay (mocked SDK)', () => {
  beforeEach(() => {
    SCRIPT = [];
    THROW_AFTER = null;
    vi.clearAllMocks();
  });

  it('a SAFE Bash command emits command/started (after clearing) then completed — no ask', async () => {
    const { gate, ask } = gateFor('approve');
    SCRIPT = [INIT, bashStarted('tu_echo', 'echo hi'), toolResult('tu_echo', false), RESULT_OK];
    const kinds = (await drain({ repo: '/r', prompt: 'p', gate })).map((e) => e.kind);
    expect(kinds).toEqual(['run.started', 'turn.started', 'command', 'command', 'run.completed']);
    expect(ask).not.toHaveBeenCalled(); // non-destructive → never asked
  });

  it('an APPROVED destructive Bash emits the command beats (started AFTER the gate cleared it)', async () => {
    const { gate, ask } = gateFor('approve');
    SCRIPT = [INIT, bashStarted('tu_rm', 'rm -rf build'), toolResult('tu_rm', false), RESULT_OK];
    const events = await drain({ repo: '/r', prompt: 'p', gate });
    expect(events.map((e) => e.kind)).toEqual(['run.started', 'turn.started', 'command', 'command', 'run.completed']);
    expect(ask).toHaveBeenCalledWith('rm -r');
    const started = events.find((e) => e.kind === 'command' && e.status === 'started');
    expect(started?.kind === 'command' && started.command).toBe('rm -rf build');
  });

  it('a DENIED destructive Bash emits a status beat, NO command event, and suppresses the blocked completion', async () => {
    const { gate } = gateFor('deny');
    // A denied command comes back blocked: is_error:true → status 'failed'.
    SCRIPT = [INIT, bashStarted('tu_rm', 'rm -rf build'), toolResult('tu_rm', true, 'This command requires approval'), RESULT_OK];
    const events = await drain({ repo: '/r', prompt: 'p', gate });
    expect(events.map((e) => e.kind)).toEqual(['run.started', 'turn.started', 'status', 'run.completed']);
    const status = events.find((e) => e.kind === 'status');
    expect(status?.kind === 'status' && status.text).toContain('rm -r');
    expect(events.some((e) => e.kind === 'command')).toBe(false); // never a command event
  });

  it('GATE-BYPASS TRIPWIRE: a denied Bash whose tool_result is is_error:false (it ran) fails the run loud', async () => {
    const { gate } = gateFor('deny');
    // The dangerous case: the gate said deny, but the command executed anyway (is_error:false).
    SCRIPT = [INIT, bashStarted('tu_rm', 'rm -rf build'), toolResult('tu_rm', false, 'removed'), RESULT_OK];
    const events = await drain({ repo: '/r', prompt: 'p', gate });
    const failed = events.find((e) => e.kind === 'run.failed');
    expect(failed?.kind === 'run.failed' && failed.error).toMatch(/gate bypass.*denied but executed/i);
    // The run STOPS at the tripwire — no run.completed after it.
    expect(events.some((e) => e.kind === 'run.completed')).toBe(false);
  });

  it('abort (instanceof AbortError) yields nothing after the throw — the pump stopped path', async () => {
    const { gate } = gateFor('approve');
    SCRIPT = [INIT, RESULT_OK];
    THROW_AFTER = 0; // throw right after INIT
    const events = await drain({ repo: '/r', prompt: 'p', gate });
    // The init beats already flowed; the AbortError is swallowed (no run.failed synthesized here —
    // the pump's stopped path owns that).
    expect(events.map((e) => e.kind)).toEqual(['run.started', 'turn.started']);
    expect(events.some((e) => e.kind === 'run.failed')).toBe(false);
  });

  it('pre-aborted signal yields nothing at all', async () => {
    const { gate } = gateFor('approve');
    SCRIPT = [INIT, RESULT_OK];
    const ac = new AbortController();
    ac.abort();
    const events = await drain({ repo: '/r', prompt: 'p', gate, signal: ac.signal });
    expect(events).toEqual([]);
  });

  it('a coding run with NO gate binding THROWS (fail loud — never run ungated)', async () => {
    SCRIPT = [INIT, RESULT_OK];
    await expect(drain({ repo: '/r', prompt: 'p' })).rejects.toThrow(/requires a destructive gate/i);
  });

  it('a readOnly run needs no gate and maps straight through', async () => {
    SCRIPT = [INIT, { type: 'assistant', message: { content: [{ type: 'text', text: 'reflection' }] } }, RESULT_OK];
    const kinds = (await drain({ repo: '/r', prompt: 'p', readOnly: true })).map((e) => e.kind);
    expect(kinds).toEqual(['run.started', 'turn.started', 'message', 'run.completed']);
  });
});
