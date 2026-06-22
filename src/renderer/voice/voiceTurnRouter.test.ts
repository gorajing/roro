import { describe, it, expect, vi } from 'vitest';
import { makeVoiceTurnRouter, type VoiceTurnDeps } from './voiceTurnRouter';

function harness(active = false) {
  // The real bridge turnRun returns Promise<{runId}> — a dispatch in flight. The latch tracks that
  // promise, so the fake must return a thenable for a dispatch to count as in-flight.
  const turnRun = vi.fn(() => Promise.resolve({ runId: 'r' }));
  const cancelTask = vi.fn();
  let isActive = active;
  const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => isActive };
  return { turnRun, cancelTask, setActive: (v: boolean) => { isActive = v; }, deps };
}

describe('voiceTurnRouter — mouth-not-brain + barge-in', () => {
  it('routes a final transcript THROUGH turnRun when idle (never bypasses the orchestrator)', () => {
    const h = harness(false);
    makeVoiceTurnRouter(h.deps).onFinalTranscript('add a logout route');
    expect(h.turnRun).toHaveBeenCalledWith('add a logout route');
    expect(h.cancelTask).not.toHaveBeenCalled();
  });

  it('trims and ignores an empty/whitespace final transcript', () => {
    const h = harness(false);
    const r = makeVoiceTurnRouter(h.deps);
    r.onFinalTranscript('   ');
    r.onFinalTranscript('\n\t');
    expect(h.turnRun).not.toHaveBeenCalled();
  });

  it('trims a real transcript', () => {
    const h = harness(false);
    makeVoiceTurnRouter(h.deps).onFinalTranscript('  hello there  ');
    expect(h.turnRun).toHaveBeenCalledWith('hello there');
  });

  it('barge-in: a final transcript during an active run cancels first, then runs on runEnd', () => {
    const h = harness(true); // a run is active
    const r = makeVoiceTurnRouter(h.deps);
    r.onFinalTranscript('actually, do this instead');
    expect(h.cancelTask).toHaveBeenCalledTimes(1);
    expect(h.turnRun).not.toHaveBeenCalled(); // queued, not started yet
    h.setActive(false);
    r.onRunEnd(); // the preempted run ended
    expect(h.turnRun).toHaveBeenCalledWith('actually, do this instead');
  });

  it('does not wedge when the bridge is unavailable (turnRun is a no-op); a later final still dispatches', () => {
    // getCompanion()?.turnRun?.(...) returns undefined when the bridge/method is missing. A non-
    // thenable return means nothing was dispatched, so the router must NOT latch — else the first
    // final wedges routing and later finals become cancel-only barge-ins forever.
    const turnRun = vi.fn().mockReturnValue(undefined);
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('first');
    r.onFinalTranscript('second');
    expect(turnRun).toHaveBeenCalledTimes(2);
    expect(turnRun).toHaveBeenNthCalledWith(1, 'first');
    expect(turnRun).toHaveBeenNthCalledWith(2, 'second');
    expect(cancelTask).not.toHaveBeenCalled(); // never a barge-in; both were fresh dispatches
  });

  it('ignores an UNRELATED run-end: only the matching runId advances the queue', async () => {
    const turnRun = vi.fn(() => Promise.resolve({ runId: 'voice-1' }));
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('hello');
    await Promise.resolve(); // let turnRun resolve -> activeRunId = 'voice-1'
    r.onRunEnd('some-other-typed-run'); // an unrelated turn ends — must NOT clear the voice latch

    // The voice run is still in flight: a new final barges in (cancel), not a 2nd concurrent dispatch.
    r.onFinalTranscript('wait, change that');
    expect(turnRun).toHaveBeenCalledTimes(1);
    expect(cancelTask).toHaveBeenCalledTimes(1);
  });

  it('advances on the MATCHING run-end (the voice run actually ended)', async () => {
    const turnRun = vi.fn(() => Promise.resolve({ runId: 'voice-1' }));
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('hello');
    await Promise.resolve(); // activeRunId = 'voice-1'
    r.onFinalTranscript('and then this'); // barge-in queued (voice-1 in flight)
    expect(cancelTask).toHaveBeenCalledTimes(1);

    r.onRunEnd('voice-1'); // the voice run's own end
    expect(turnRun).toHaveBeenCalledTimes(2);
    expect(turnRun).toHaveBeenLastCalledWith('and then this');
  });

  it('ignores a STALE dispatch resolution: a superseded run id cannot clobber the current one', async () => {
    let resolveA!: (v: { runId: string }) => void;
    let resolveB!: (v: { runId: string }) => void;
    const pA = new Promise<{ runId: string }>((res) => { resolveA = res; });
    const pB = new Promise<{ runId: string }>((res) => { resolveB = res; });
    const turnRun = vi.fn()
      .mockReturnValueOnce(pA) // run A
      .mockReturnValueOnce(pB) // run B (supersedes A)
      .mockReturnValue(Promise.resolve({ runId: 'C' }));
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('A'); // dispatch A (pA pending; activeRunId not known yet)
    r.onFinalTranscript('B'); // A in flight -> barge-in queued
    r.onRunEnd(); // A ends before pA resolves (activeRunId null) -> advance -> dispatch B
    expect(turnRun).toHaveBeenNthCalledWith(2, 'B');

    resolveB({ runId: 'B' });
    await Promise.resolve();
    resolveA({ runId: 'A' }); // A's LATE resolution is superseded — must NOT clobber activeRunId
    await Promise.resolve();

    r.onFinalTranscript('C'); // B in flight -> barge-in queued
    expect(cancelTask).toHaveBeenCalledTimes(2);
    r.onRunEnd('B'); // B's own end MUST advance (not be ignored because of a stale 'A')
    expect(turnRun).toHaveBeenNthCalledWith(3, 'C');
  });

  it('a runEnd with no pending barge-in does nothing', () => {
    const h = harness(false);
    makeVoiceTurnRouter(h.deps).onRunEnd();
    expect(h.turnRun).not.toHaveBeenCalled();
  });

  it('does NOT double-dispatch when a second final arrives before run.started echoes', () => {
    // isRunActive() reads runState.active, which only flips once the pushed run.started arrives —
    // turnRun spends time in recall/decide first. A synchronous latch must gate the window so two
    // rapid finals can't both start concurrent turns.
    const h = harness(false); // run.started has NOT echoed yet
    const r = makeVoiceTurnRouter(h.deps);
    r.onFinalTranscript('first');
    r.onFinalTranscript('second'); // arrives in the gap before runState.active flips
    expect(h.turnRun).toHaveBeenCalledTimes(1); // exactly one turn dispatched
    expect(h.turnRun).toHaveBeenCalledWith('first');
    expect(h.cancelTask).toHaveBeenCalledTimes(1); // the second is a barge-in, not a 2nd run
    h.setActive(false);
    r.onRunEnd();
    expect(h.turnRun).toHaveBeenCalledTimes(2);
    expect(h.turnRun).toHaveBeenLastCalledWith('second');
  });

  it('clears the in-flight latch if turnRun rejects before any runEnd (voice recovers, not wedged)', async () => {
    const turnRun = vi.fn()
      .mockReturnValueOnce(Promise.reject(new Error('ipc down'))) // dispatch fails; no runEnd will come
      .mockReturnValueOnce(undefined);
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('first');
    await Promise.resolve(); await Promise.resolve(); // let the rejection handler run

    r.onFinalTranscript('second'); // the latch must have cleared -> a fresh dispatch, NOT a barge-in
    expect(turnRun).toHaveBeenCalledTimes(2);
    expect(turnRun).toHaveBeenLastCalledWith('second');
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('fires a queued barge-in when the in-flight dispatch rejects (not stranded for a later run)', async () => {
    let rejectFirst!: (e: unknown) => void;
    const firstPromise = new Promise((_, rej) => { rejectFirst = rej; });
    const turnRun = vi.fn()
      .mockReturnValueOnce(firstPromise) // 'first' dispatch stays pending
      .mockReturnValueOnce(undefined); // 'second' dispatch
    const cancelTask = vi.fn();
    const deps: VoiceTurnDeps = { turnRun, cancelTask, isRunActive: () => false };
    const r = makeVoiceTurnRouter(deps);

    r.onFinalTranscript('first'); // dispatched; promise still pending
    r.onFinalTranscript('second'); // queued as barge-in (latch set), cancelTask called
    expect(turnRun).toHaveBeenCalledTimes(1);
    expect(cancelTask).toHaveBeenCalledTimes(1);

    rejectFirst(new Error('dispatch failed'));
    await Promise.resolve(); await Promise.resolve(); // let the rejection handler run

    // 'second' must fire NOW (the run it waited for died) — not linger to replay on a later run.
    expect(turnRun).toHaveBeenCalledTimes(2);
    expect(turnRun).toHaveBeenLastCalledWith('second');
  });

  it('only the latest barge-in utterance wins if several arrive mid-run', () => {
    const h = harness(true);
    const r = makeVoiceTurnRouter(h.deps);
    r.onFinalTranscript('first');
    r.onFinalTranscript('second'); // supersedes the queued one
    expect(h.cancelTask).toHaveBeenCalledTimes(2);
    h.setActive(false);
    r.onRunEnd();
    expect(h.turnRun).toHaveBeenCalledTimes(1);
    expect(h.turnRun).toHaveBeenCalledWith('second');
  });
});
