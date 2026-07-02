import { describe, it, expect } from 'vitest';
import { finalTerminalEvent, type ExitContext } from './exitAccounting';

// c5: a CLI that spawns fine, runs, then exits NONZERO without emitting a JSON terminal event (crash / OOM /
// signal / a nonzero exit with no result) must NOT be reported as success. This decides the adapter's
// post-stream terminal so a crashed agent fails loud (with the exit code + a stderr tail) instead of the
// orchestrator synthesizing a fabricated run.completed (which would also poison memory with outcome:completed).

const base: ExitContext = {
  runId: 'r1', bin: 'codex', emittedTerminal: false, aborted: false, spawnError: false,
  code: 0, signal: null, stderrTail: '',
};

describe('finalTerminalEvent — account for a child exit with no JSON terminal', () => {
  it('emits run.failed on a NONZERO exit with no terminal (the false-success bug)', () => {
    const ev = finalTerminalEvent({ ...base, code: 1, stderrTail: 'panic: nil deref' }, 0);
    expect(ev?.kind).toBe('run.failed');
    expect((ev as { error: string }).error).toMatch(/code 1/);
    expect((ev as { error: string }).error).toMatch(/panic: nil deref/);
  });

  it('emits run.failed on a KILLED child (signal) with no terminal', () => {
    const ev = finalTerminalEvent({ ...base, code: null, signal: 'SIGKILL' }, 0);
    expect(ev?.kind).toBe('run.failed');
    expect((ev as { error: string }).error).toMatch(/SIGKILL/);
  });

  it('returns null when the stream ALREADY emitted a terminal (no double-emit)', () => {
    expect(finalTerminalEvent({ ...base, code: 1, emittedTerminal: true }, 0)).toBeNull();
  });

  it('returns null when aborted or a spawn error already accounts for the end', () => {
    expect(finalTerminalEvent({ ...base, code: 1, aborted: true }, 0)).toBeNull();
    expect(finalTerminalEvent({ ...base, code: 1, spawnError: true }, 0)).toBeNull();
  });

  it('returns null on a CLEAN exit (code 0) with no terminal — the orchestrator decides (now fail-loud)', () => {
    expect(finalTerminalEvent({ ...base, code: 0 }, 0)).toBeNull();
  });
});
