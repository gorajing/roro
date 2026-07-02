import { describe, it, expect, vi } from 'vitest';
import { AmbientTrigger, type AmbientTriggerDeps } from './trigger';

function makeDeps(over: Partial<AmbientTriggerDeps> = {}): AmbientTriggerDeps {
  return {
    isEnabled: () => true,
    capture: vi.fn().mockResolvedValue({ b64: 'AAAA', mime: 'image/jpeg' }),
    describe: vi.fn().mockResolvedValue('terminal: test_login FAILED'),
    runProactiveTurn: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('AmbientTrigger', () => {
  it('does nothing — not even capture — when disabled (default-off gate)', async () => {
    const capture = vi.fn();
    const runProactiveTurn = vi.fn();
    const deps = makeDeps({ isEnabled: () => false, capture, runProactiveTurn });
    expect(await new AmbientTrigger(deps).tick()).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(runProactiveTurn).not.toHaveBeenCalled();
  });

  it('fires a proactive turn on a genuinely new event when enabled', async () => {
    const runProactiveTurn = vi.fn().mockResolvedValue(undefined);
    const fired = await new AmbientTrigger(makeDeps({ runProactiveTurn })).tick();
    expect(fired).toBe(true);
    expect(runProactiveTurn).toHaveBeenCalledOnce();
    expect(runProactiveTurn.mock.calls[0][0]).toMatchObject({ kind: 'change', app: 'terminal' });
  });

  it('stays quiet on a repeat of the same observation (edge-trigger)', async () => {
    const runProactiveTurn = vi.fn().mockResolvedValue(undefined);
    const trigger = new AmbientTrigger(makeDeps({ runProactiveTurn }));
    expect(await trigger.tick()).toBe(true);  // first sighting fires
    expect(await trigger.tick()).toBe(false); // same thing still there → quiet
    expect(runProactiveTurn).toHaveBeenCalledOnce();
  });

  it('does not fire on a non-event (idle/unknown)', async () => {
    const runProactiveTurn = vi.fn();
    const deps = makeDeps({ describe: vi.fn().mockResolvedValue('the terminal is idle, no new output'), runProactiveTurn });
    expect(await new AmbientTrigger(deps).tick()).toBe(false);
    expect(runProactiveTurn).not.toHaveBeenCalled();
  });

  it('fires again when the situation actually changes', async () => {
    const runProactiveTurn = vi.fn().mockResolvedValue(undefined);
    const describe = vi.fn()
      .mockResolvedValueOnce('terminal: test_login FAILED')
      .mockResolvedValueOnce('terminal: test_login FAILED') // repeat
      .mockResolvedValueOnce('terminal: test_login PASSED'); // changed
    const trigger = new AmbientTrigger(makeDeps({ describe, runProactiveTurn }));
    expect(await trigger.tick()).toBe(true);
    expect(await trigger.tick()).toBe(false);
    expect(await trigger.tick()).toBe(true);
    expect(runProactiveTurn).toHaveBeenCalledTimes(2);
  });

  it('does not latch when the proactive turn fails — the event is retried, not dropped', async () => {
    const runProactiveTurn = vi.fn()
      .mockRejectedValueOnce(new Error('orchestrator busy')) // transient failure on first attempt
      .mockResolvedValueOnce(undefined);                     // retry succeeds
    const trigger = new AmbientTrigger(makeDeps({ runProactiveTurn }));
    await expect(trigger.tick()).rejects.toThrow('orchestrator busy'); // fail-loud, not swallowed
    // same screen on the next tick → retried, not suppressed as already-acknowledged
    expect(await trigger.tick()).toBe(true);
    expect(runProactiveTurn).toHaveBeenCalledTimes(2);
  });
});
