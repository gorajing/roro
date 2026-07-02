import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunRegistry } from './runRegistry';
import { Turn, type TurnPhase } from './turnState';

// Unit pins for the W4 run state machine (docs/plans/run-state-machine.md): legal edges,
// the requestStop dispatch table, the busy non-queuing race, idempotent end, stale-id no-op.
// The registry is constructed with FAKE sinks — the singleton's real wiring (safeSend +
// confirmGate) is exercised by the orchestrator pin suites.

function makeRegistry() {
  const pushRunEnd = vi.fn<(runId: string) => void>();
  const denyConfirm = vi.fn<(runId: string) => void>();
  const registry = new RunRegistry({ pushRunEnd, denyConfirm });
  return { registry, pushRunEnd, denyConfirm };
}

/** Drive a minted turn to `running` through the only legal route (a committed dispatch). */
function driveToRunning(registry: RunRegistry, turn: Turn, controller = new AbortController()): AbortController {
  turn.to({ kind: 'deciding', pass: 1 });
  turn.to({ kind: 'gating' });
  turn.to({ kind: 'confirming' });
  const section = registry.tryBeginDispatch(turn);
  if (!section) throw new Error('expected an open dispatch section');
  turn.to({ kind: 'dispatching' });
  section.commit(controller);
  return controller;
}

describe('Turn legal edges', () => {
  let onEnded: ReturnType<typeof vi.fn>;
  let turn: Turn;

  beforeEach(() => {
    onEnded = vi.fn();
    turn = new Turn('r1', onEnded);
  });

  it('walks the primary run_agent route: minted → deciding{1} → gating → confirming → dispatching → running', () => {
    expect(turn.phase).toEqual({ kind: 'minted' });
    turn.to({ kind: 'deciding', pass: 1 });
    turn.to({ kind: 'gating' });
    turn.to({ kind: 'confirming' });
    turn.to({ kind: 'dispatching' });
    turn.to({ kind: 'running' });
    expect(turn.phase).toEqual({ kind: 'running' });
  });

  it('walks the capture_screen route: deciding{1} → capturing → deciding{2} → gating', () => {
    turn.to({ kind: 'deciding', pass: 1 });
    turn.to({ kind: 'capturing' });
    turn.to({ kind: 'deciding', pass: 2 });
    turn.to({ kind: 'gating' });
    expect(turn.phase).toEqual({ kind: 'gating' });
  });

  it('walks the runTask route: minted → gating (no deciding pass)', () => {
    turn.to({ kind: 'gating' });
    expect(turn.phase).toEqual({ kind: 'gating' });
  });

  it('THROWS on illegal edges (fail loud): minted → running, capturing → deciding{1}, deciding{2} → capturing', () => {
    expect(() => turn.to({ kind: 'running' })).toThrow(/illegal transition: minted → running/);
    turn.to({ kind: 'deciding', pass: 1 });
    turn.to({ kind: 'capturing' });
    expect(() => turn.to({ kind: 'deciding', pass: 1 })).toThrow(/illegal transition/);
    turn.to({ kind: 'deciding', pass: 2 });
    expect(() => turn.to({ kind: 'capturing' })).toThrow(/illegal transition/); // one capture per turn
  });

  it('lets a decide-throw end straight out of deciding (real edge: end() is legal from any live phase)', () => {
    turn.to({ kind: 'deciding', pass: 1 });
    expect(turn.end({ kind: 'failed', error: 'decide failed: boom' })).toBe(true);
    expect(turn.phase).toEqual({ kind: 'ended', cause: { kind: 'failed', error: 'decide failed: boom' } });
  });

  it('keeps `stopping` sticky: forward to() calls no-op until a checkpoint consumes it via end(stopped)', () => {
    turn.to({ kind: 'deciding', pass: 1 });
    turn.to({ kind: 'stopping' });
    turn.to({ kind: 'capturing' }); // in-flight progress after a Stop — must NOT clobber the stop
    expect(turn.phase).toEqual({ kind: 'stopping' });
    expect(turn.stopRequested).toBe(true);
    expect(turn.end({ kind: 'stopped' })).toBe(true);
    expect(turn.phase).toEqual({ kind: 'ended', cause: { kind: 'stopped' } });
  });

  it('to() after ended throws — only end() is a tolerated repeat', () => {
    turn.end({ kind: 'completed' });
    expect(() => turn.to({ kind: 'deciding', pass: 1 })).toThrow(/illegal transition: ended/);
  });
});

describe('Turn.end idempotence', () => {
  it('ends once: the second end() returns false and fires no second onEnded/runEnd', () => {
    const onEnded = vi.fn();
    const turn = new Turn('r1', onEnded);
    expect(turn.end({ kind: 'completed' })).toBe(true);
    expect(turn.end({ kind: 'failed', error: 'late' })).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect((turn.phase as Extract<TurnPhase, { kind: 'ended' }>).cause).toEqual({ kind: 'completed' }); // first cause wins
  });
});

describe('RunRegistry.requestStop dispatch table', () => {
  it("pre-dispatch phases -> 'stopping' + the pending destructive confirm is denied", () => {
    const { registry, denyConfirm } = makeRegistry();
    const turn = registry.mint('r1');
    turn.to({ kind: 'deciding', pass: 1 });
    expect(registry.requestStop('r1')).toBe('stopping');
    expect(turn.stopRequested).toBe(true);
    expect(denyConfirm).toHaveBeenCalledWith('r1');
  });

  it("'stopping' again is a stable repeat (still 'stopping', deny fired again, phase intact)", () => {
    const { registry, denyConfirm } = makeRegistry();
    const turn = registry.mint('r1');
    registry.requestStop('r1');
    expect(registry.requestStop('r1')).toBe('stopping');
    expect(turn.stopRequested).toBe(true);
    expect(denyConfirm).toHaveBeenCalledTimes(2);
  });

  it("running -> 'aborted-pump': aborts the pump's controller, still denies the confirm, phase stays running", () => {
    const { registry, denyConfirm } = makeRegistry();
    const turn = registry.mint('r1');
    const controller = driveToRunning(registry, turn);
    expect(registry.requestStop('r1')).toBe('aborted-pump');
    expect(controller.signal.aborted).toBe(true);
    expect(denyConfirm).toHaveBeenCalledWith('r1'); // mitigation 4: deny in dispatched phases too
    expect(turn.phase).toEqual({ kind: 'running' }); // the pump (watchdog/drain) owns the ending
  });

  it("unknown / stale ids -> 'ignored' (an ended turn leaves the registry)", () => {
    const { registry, pushRunEnd } = makeRegistry();
    expect(registry.requestStop('never-minted')).toBe('ignored');
    const turn = registry.mint('r1');
    turn.end({ kind: 'completed' });
    expect(pushRunEnd).toHaveBeenCalledTimes(1);
    expect(registry.requestStop('r1')).toBe('ignored'); // stale-id no-op
    expect(pushRunEnd).toHaveBeenCalledTimes(1);
  });

  it("a DRAINING run (turn ended, slot still held) -> 'ignored' for a targeted stop, but abortPump still reaches it", () => {
    const { registry } = makeRegistry();
    const turn = registry.mint('r1');
    const controller = driveToRunning(registry, turn);
    turn.end({ kind: 'stopped' }); // watchdog ended the UI; the stream is still draining
    expect(registry.slotHolder()).toBe('r1'); // the slot is NOT freed by the UI end
    expect(registry.requestStop('r1')).toBe('ignored');
    registry.abortPump('r1'); // the no-id Stop fallback still aborts the latest running executor
    expect(controller.signal.aborted).toBe(true);
  });
});

describe('RunRegistry dispatch section (the busy non-queuing race)', () => {
  it('refuses a second dispatch while a section is OPEN (the awaited clean-tree window)', () => {
    const { registry } = makeRegistry();
    const a = registry.mint('a');
    a.to({ kind: 'gating' });
    a.to({ kind: 'confirming' });
    const section = registry.tryBeginDispatch(a);
    expect(section).not.toBeNull();
    const b = registry.mint('b');
    expect(registry.tryBeginDispatch(b)).toBeNull(); // busy — refuse, never queue
    section?.close();
    expect(registry.tryBeginDispatch(b)).not.toBeNull(); // abandoned section frees the lock
  });

  it('refuses while the slot is occupied, and frees only at releasePump (drain), not at turn end', () => {
    const { registry } = makeRegistry();
    const a = registry.mint('a');
    driveToRunning(registry, a);
    const b = registry.mint('b');
    expect(registry.tryBeginDispatch(b)).toBeNull(); // slot occupied
    a.end({ kind: 'stopped' }); // UI ends…
    expect(registry.tryBeginDispatch(b)).toBeNull(); // …but the slot is retained until drain
    registry.releasePump('a');
    expect(registry.tryBeginDispatch(b)).not.toBeNull();
  });

  it('commit() occupies the slot, moves the turn to running, and closes the section atomically', () => {
    const { registry } = makeRegistry();
    const a = registry.mint('a');
    a.to({ kind: 'gating' });
    a.to({ kind: 'confirming' });
    const section = registry.tryBeginDispatch(a);
    a.to({ kind: 'dispatching' });
    section?.commit(new AbortController());
    expect(a.phase).toEqual({ kind: 'running' });
    expect(registry.slotHolder()).toBe('a');
    expect(() => section?.commit(new AbortController())).toThrow(/closed dispatch section/);
  });

  it('close() after commit is the tolerated finally no-op; releasePump for a non-holder is a no-op', () => {
    const { registry } = makeRegistry();
    const a = registry.mint('a');
    a.to({ kind: 'gating' });
    a.to({ kind: 'confirming' });
    const section = registry.tryBeginDispatch(a);
    a.to({ kind: 'dispatching' });
    section?.commit(new AbortController());
    section?.close(); // guardedDispatch's finally
    expect(registry.slotHolder()).toBe('a'); // close never frees the slot
    registry.releasePump('someone-else');
    expect(registry.slotHolder()).toBe('a');
  });
});

describe('RunRegistry end plumbing', () => {
  it('pushes runEnd exactly once per turn and removes it from the registry', () => {
    const { registry, pushRunEnd } = makeRegistry();
    const turn = registry.mint('r1');
    expect(registry.get('r1')).toBe(turn);
    expect(turn.end({ kind: 'completed' })).toBe(true);
    expect(turn.end({ kind: 'completed' })).toBe(false); // idempotent-by-return
    expect(pushRunEnd).toHaveBeenCalledTimes(1);
    expect(pushRunEnd).toHaveBeenCalledWith('r1');
    expect(registry.get('r1')).toBeUndefined();
  });

  it('tracks lastTurnId across mints (the no-id Stop fallback target)', () => {
    const { registry } = makeRegistry();
    registry.mint('r1');
    expect(registry.lastTurnId).toBe('r1');
    registry.mint('r2');
    expect(registry.lastTurnId).toBe('r2');
  });

  it('cancelAll aborts and frees the slot immediately (app-quit: no drain wait by design)', () => {
    const { registry } = makeRegistry();
    const a = registry.mint('a');
    const controller = driveToRunning(registry, a);
    registry.cancelAll();
    expect(controller.signal.aborted).toBe(true);
    expect(registry.slotHolder()).toBeNull();
  });
});
