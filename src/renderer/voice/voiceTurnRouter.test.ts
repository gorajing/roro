import { describe, it, expect, vi } from 'vitest';
import { makeVoiceTurnRouter, type VoiceTurnDeps } from './voiceTurnRouter';

function harness(active = false) {
  const turnRun = vi.fn();
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

  it('a runEnd with no pending barge-in does nothing', () => {
    const h = harness(false);
    makeVoiceTurnRouter(h.deps).onRunEnd();
    expect(h.turnRun).not.toHaveBeenCalled();
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
