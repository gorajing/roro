import { describe, it, expect, vi } from 'vitest';
import { mountLocalVoiceMode } from './mountLocalVoiceMode';
import { createFakeVoiceEngine } from './fakeVoiceEngine';
import type { ActionEvent } from '../../shared/events';

function fakeBus() {
  let cb: ((e: ActionEvent) => void) | undefined;
  return {
    onActionEvent: (c: (e: ActionEvent) => void) => { cb = c; return () => { cb = undefined; }; },
    emit: (e: ActionEvent) => cb?.(e),
  };
}
function fakeDeps() {
  let runEnd: ((runId?: string) => void) | undefined;
  return {
    turnRun: vi.fn((_t: string) => Promise.resolve({ runId: 'r1' })),
    cancelTask: vi.fn(),
    isRunActive: vi.fn(() => false),
    onRunEnd: vi.fn((cb: (runId?: string) => void) => { runEnd = cb; return () => { runEnd = undefined; }; }),
    fireRunEnd: (id?: string) => runEnd?.(id),
    isDetached: () => runEnd === undefined,
  };
}

describe('mountLocalVoiceMode — composes the local voice path (input + output)', () => {
  it('routes a committed utterance to turnRun (mouth-not-brain) and speaks a returned message', async () => {
    const engine = createFakeVoiceEngine();
    const deps = fakeDeps();
    const bus = fakeBus();
    const poke = vi.fn();
    const lv = mountLocalVoiceMode({ engine, detect: () => true, deps, onActionEvent: bus.onActionEvent, driver: { poke } });

    expect(lv.available).toBe(true);
    await lv.mode.summon();
    engine.utter('add a logout route'); // committed utterance
    expect(poke).toHaveBeenCalled(); // ear-perk fired on speech start
    expect(deps.turnRun).toHaveBeenCalledWith('add a logout route'); // routed through the orchestrator

    bus.emit({ kind: 'message', runId: 'r1', text: 'on it', ts: 0 }); // the cat's narration comes back
    expect(engine.spoken).toContain('on it'); // spoken via local TTS (voice is summoned)
    lv.dispose();
  });

  it('does NOT speak a message while NOT summoned (voice off = silent peer)', () => {
    const engine = createFakeVoiceEngine();
    const bus = fakeBus();
    const lv = mountLocalVoiceMode({ engine, detect: () => true, deps: fakeDeps(), onActionEvent: bus.onActionEvent, driver: { poke: vi.fn() } });
    bus.emit({ kind: 'message', runId: 'r1', text: 'silent', ts: 0 }); // never summoned
    expect(engine.spoken).toEqual([]);
    lv.dispose();
  });

  it('dispose() detaches the runEnd subscription (no late runEnd can drain the router post-teardown)', async () => {
    const engine = createFakeVoiceEngine();
    const deps = fakeDeps();
    const lv = mountLocalVoiceMode({ engine, detect: () => true, deps, onActionEvent: fakeBus().onActionEvent, driver: { poke: vi.fn() } });
    await lv.mode.summon();
    lv.dispose();
    expect(deps.isDetached()).toBe(true); // the onRunEnd handler was unsubscribed
    deps.turnRun.mockClear();
    deps.fireRunEnd('r1'); // a late runEnd after dispose
    expect(deps.turnRun).not.toHaveBeenCalled(); // can't dispatch a queued turn
  });

  it('is inert + available=false when no engine is present (caller falls back to Vapi/stub)', () => {
    const bus = fakeBus();
    const lv = mountLocalVoiceMode({ detect: () => false, deps: fakeDeps(), onActionEvent: bus.onActionEvent, driver: { poke: vi.fn() } });
    expect(lv.available).toBe(false);
    expect(lv.mode.available).toBe(false);
    lv.dispose();
  });
});
