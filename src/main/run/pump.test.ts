import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ActionEvent } from '../../shared/events';
import type { EndCause } from './turnState';
import { pumpRun, type PumpSinks, type TerminalEvent } from './pump';

// Unit pins for the PUMP machine (docs/plans/run-state-machine.md): the pinned loop
// micro-ordering (stamp → guard → emit → terminal hooks → remember), the no-verdict synthesis
// (NO success arm), the 1.5s Stop watchdog + drop-while-draining, the mid-run destructive
// guard, and slot release ONLY at the stream's true end. Fake RunSource + fake timers.

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeSinks(overrides: Partial<PumpSinks> = {}) {
  const calls: string[] = [];
  const emitted: ActionEvent[] = [];
  const remembered: ActionEvent[] = [];
  const notified: Array<{ ok: boolean; detail?: string }> = [];
  const verdicts: TerminalEvent[] = [];
  const ends: EndCause[] = [];
  const sinks: PumpSinks = {
    emit: vi.fn((e: ActionEvent) => { calls.push(`emit:${e.kind}`); emitted.push(e); }),
    remember: vi.fn((e: ActionEvent) => { calls.push(`remember:${e.kind}`); remembered.push(e); }),
    notify: vi.fn((ok: boolean, detail?: string) => { calls.push(`notify:${ok}`); notified.push({ ok, detail }); }),
    onVerdict: vi.fn((t: TerminalEvent) => { calls.push(`verdict:${t.kind}`); verdicts.push(t); }),
    guard: vi.fn(() => null),
    endUi: vi.fn((cause: EndCause) => { calls.push(`endUi:${cause.kind}`); ends.push(cause); }),
    releaseSlot: vi.fn(() => { calls.push('releaseSlot'); }),
    ...overrides,
  };
  return { sinks, calls, emitted, remembered, notified, verdicts, ends };
}

const started = (runId = 'exec-run'): ActionEvent => ({ kind: 'run.started', runId, agent: 'codex', ts: 0 });
const completed = (finalText = 'done', runId = 'exec-run'): ActionEvent =>
  ({ kind: 'run.completed', runId, ok: true, finalText, ts: 0 });

describe('pumpRun', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-stamps every event to the pump runId and preserves the pinned loop order', async () => {
    const events = (async function* () {
      yield started();
      yield { kind: 'command', runId: 'exec-run', itemId: 'c1', status: 'started', command: 'npm test', ts: 0 } as ActionEvent;
      yield completed();
    })();
    const { sinks, calls, emitted, verdicts, ends } = makeSinks();
    await pumpRun('r1', { events, controller: new AbortController() }, sinks);

    expect(emitted.map((e) => e.runId)).toEqual(['r1', 'r1', 'r1']); // one id per turn
    // Pinned micro-ordering: emit → (terminal: notify → verdict) → remember; then the close
    // sequence: releaseSlot (stream truly ended) → endUi.
    expect(calls).toEqual([
      'emit:run.started', 'remember:run.started',
      'emit:command', 'remember:command',
      'emit:run.completed', 'notify:true', 'verdict:run.completed', 'remember:run.completed',
      'releaseSlot', 'endUi:completed',
    ]);
    expect(verdicts).toHaveLength(1);
    expect(ends).toEqual([{ kind: 'completed' }]);
    expect(sinks.guard).toHaveBeenCalledTimes(3); // guard consulted before every emit
  });

  it('a real run.failed verdict ends the turn failed{error} and still reaches onVerdict', async () => {
    const events = (async function* () {
      yield started();
      yield { kind: 'run.failed', runId: 'exec-run', ok: false, error: 'boom', ts: 0 } as ActionEvent;
    })();
    const { sinks, ends, verdicts, notified } = makeSinks();
    await pumpRun('r1', { events, controller: new AbortController() }, sinks);
    expect(ends).toEqual([{ kind: 'failed', error: 'boom' }]);
    expect(verdicts).toEqual([expect.objectContaining({ kind: 'run.failed', error: 'boom' })]);
    expect(notified).toContainEqual({ ok: false, detail: 'boom' });
  });

  it('synthesizes run.failed — NEVER run.completed — when the stream ends with no verdict (c5)', async () => {
    const events = (async function* () {
      yield started();
      // ...then the stream just ENDS — no run.completed / run.failed (a crash with no result)
    })();
    const { sinks, emitted, remembered, verdicts, ends } = makeSinks();
    await pumpRun('r1', { events, controller: new AbortController() }, sinks);

    const kinds = emitted.map((e) => e.kind);
    expect(kinds).toContain('run.failed');
    expect(kinds).not.toContain('run.completed'); // NO success arm
    const synth = emitted.find((e) => e.kind === 'run.failed');
    expect(synth).toMatchObject({ runId: 'r1', error: expect.stringContaining('ended without a result') });
    expect(remembered.map((e) => e.kind)).toContain('run.failed'); // the synthesis is persisted
    expect(verdicts).toHaveLength(0); // onVerdict is for STREAM verdicts only
    expect(ends).toEqual([{ kind: 'failed', error: expect.stringContaining('ended without a result') as unknown as string }]);
  });

  it('a thrown stream produces a terminal failure + endUi (no remember for the synthesis — pinned)', async () => {
    const events = (async function* () {
      yield started();
      throw new Error('spawn ENOENT');
    })();
    const { sinks, emitted, remembered, ends, notified } = makeSinks();
    await pumpRun('r1', { events, controller: new AbortController() }, sinks);

    expect(emitted).toContainEqual(expect.objectContaining({ kind: 'run.failed', error: 'spawn ENOENT' }));
    expect(notified).toContainEqual({ ok: false, detail: 'spawn ENOENT' });
    expect(remembered.map((e) => e.kind)).not.toContain('run.failed'); // today's catch path never remembered
    expect(ends).toEqual([{ kind: 'failed', error: 'spawn ENOENT' }]);
    expect(sinks.releaseSlot).toHaveBeenCalledTimes(1);
  });

  it('watchdog: 1501ms after abort the UI ends stopped; late events are DROPPED; the slot frees only at drain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const controller = new AbortController();
    const aborted = deferred();
    const drain = deferred();
    controller.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    const events = (async function* () {
      yield started();
      await aborted.promise;
      await drain.promise;
      yield completed('late success');
    })();
    const { sinks, emitted, remembered, ends } = makeSinks();
    const done = pumpRun('r1', { events, controller }, sinks);
    await flush();

    controller.abort();
    await flush();
    expect(ends).toHaveLength(0); // armed, not fired
    await vi.advanceTimersByTimeAsync(1501);

    expect(emitted).toContainEqual(expect.objectContaining({ kind: 'run.failed', runId: 'r1', error: 'stopped' }));
    expect(ends).toEqual([{ kind: 'stopped' }]); // Stop is provably terminal at 1.5s
    expect(sinks.releaseSlot).not.toHaveBeenCalled(); // the slot is retained until the true end

    drain.resolve();
    await done;
    expect(emitted.map((e) => e.kind)).not.toContain('run.completed'); // dropped while draining
    expect(remembered.map((e) => e.kind)).not.toContain('run.completed');
    expect(sinks.releaseSlot).toHaveBeenCalledTimes(1);
    expect(sinks.endUi).toHaveBeenCalledTimes(1); // the finally endUi is the tolerated no-op
  });

  it('an aborted stream that drains BEFORE the watchdog ends quietly stopped (no synthesized failure)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const controller = new AbortController();
    const aborted = deferred();
    controller.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    const events = (async function* () {
      yield started();
      await aborted.promise; // honors abort promptly — the stream ends with no terminal
    })();
    const { sinks, emitted, ends } = makeSinks();
    const done = pumpRun('r1', { events, controller }, sinks);
    await flush();

    controller.abort();
    await done;
    expect(emitted.map((e) => e.kind)).toEqual(['run.started']); // no synthesized event for a quiet stop
    expect(ends).toEqual([{ kind: 'stopped' }]);
    await vi.advanceTimersByTimeAsync(2000); // the watchdog was cleared at close — nothing fires late
    expect(sinks.endUi).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
  });

  it('guard block: aborts the source, emits the blocked failure, drops the blocked event and the late verdict', async () => {
    const controller = new AbortController();
    const aborted = deferred();
    const drain = deferred();
    controller.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    const events = (async function* () {
      yield started();
      yield { kind: 'command', runId: 'exec-run', itemId: 'c1', status: 'started', command: 'rm -rf build', ts: 0 } as ActionEvent;
      await Promise.race([aborted.promise, drain.promise]);
      await drain.promise;
      yield completed('late success');
    })();
    const { sinks, emitted, verdicts, ends } = makeSinks({
      guard: vi.fn((e: ActionEvent) => (e.kind === 'command' && e.command === 'rm -rf build' ? 'rm -rf' : null)),
    });
    const done = pumpRun('r1', { events, controller }, sinks);
    await flush();
    await flush();

    expect(controller.signal.aborted).toBe(true);
    expect(emitted).toContainEqual(
      expect.objectContaining({ kind: 'run.failed', error: 'blocked unapproved destructive command: rm -rf' }),
    );
    expect(emitted.map((e) => e.kind)).not.toContain('command'); // the blocked event never reaches the renderer
    expect(ends).toEqual([{ kind: 'failed', error: 'blocked unapproved destructive command: rm -rf' }]);

    drain.resolve();
    await done;
    expect(emitted.map((e) => e.kind)).not.toContain('run.completed'); // dropped while draining
    expect(verdicts).toHaveLength(0);
    expect(sinks.releaseSlot).toHaveBeenCalledTimes(1);
  });
});
