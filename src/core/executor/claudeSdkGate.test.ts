import { describe, expect, it, vi } from 'vitest';
import { createSdkGate, gateDenyMessage, type DestructiveGate } from './claudeSdkGate';
import type { DestructiveVerdict } from '../orchestrator/destructive';

// The pure permission-adjudication core (no electron, no SDK). These pins ARE the W6 permission
// architecture — every property the two SDK seams (PreToolUse hook + canUseTool) rely on:
// memoized delegate, reason-class memoization, deny-continues, the Stop race, the approved-id
// ledger, and the gate-bypass tripwire.

/** A classifier stub: destructive iff the command contains one of the given needles→reason. */
function classifierFor(map: Record<string, string>): (command: string) => DestructiveVerdict {
  return (command: string) => {
    for (const [needle, reason] of Object.entries(map)) {
      if (command.includes(needle)) return { destructive: true, reason };
    }
    return { destructive: false };
  };
}

function makeGate(overrides: Partial<DestructiveGate> = {}): {
  gate: DestructiveGate;
  ask: ReturnType<typeof vi.fn>;
  onCleared: ReturnType<typeof vi.fn>;
} {
  const ask = vi.fn(async () => true);
  const onCleared = vi.fn();
  const gate: DestructiveGate = {
    classify: classifierFor({ 'rm -rf': 'recursive file deletion (rm -r)', 'git push --force': 'force push' }),
    ask,
    onCleared,
    ...overrides,
  };
  return { gate, ask, onCleared };
}

describe('createSdkGate — pure destructive adjudication core', () => {
  it('pre-screens: a non-destructive command clears WITHOUT ever asking', async () => {
    const { gate, ask, onCleared } = makeGate();
    const g = createSdkGate('run_1', gate);
    const d = await g.adjudicate('tu_echo', 'echo hello');
    expect(d).toEqual({ behavior: 'allow' });
    expect(ask).not.toHaveBeenCalled();
    // Non-destructive: NOT in the approved-destructive ledger, but it DID traverse the gate.
    expect(onCleared).not.toHaveBeenCalled();
    expect(g.wasApprovedDestructive('tu_echo')).toBe(false);
    expect(g.wasAdjudicated('tu_echo')).toBe(true);
  });

  it('asks on a destructive command; approval allows AND records the toolUseId in the ledger', async () => {
    const { gate, ask, onCleared } = makeGate();
    const g = createSdkGate('run_1', gate);
    const d = await g.adjudicate('tu_rm', 'rm -rf build');
    expect(d).toEqual({ behavior: 'allow' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('recursive file deletion (rm -r)');
    expect(onCleared).toHaveBeenCalledWith('tu_rm');
    expect(g.wasApprovedDestructive('tu_rm')).toBe(true);
  });

  it('deny-continues: a denied destructive returns deny{message}, NEVER throws, and is not ledgered', async () => {
    const { gate, ask, onCleared } = makeGate({ ask: vi.fn(async () => false) });
    const g = createSdkGate('run_1', gate);
    const d = await g.adjudicate('tu_rm', 'rm -rf build');
    expect(d).toEqual({ behavior: 'deny', message: gateDenyMessage('recursive file deletion (rm -r)') });
    expect(onCleared).not.toHaveBeenCalled();
    expect(g.wasApprovedDestructive('tu_rm')).toBe(false);
    // wasAdjudicated is still true — it traversed the gate and was denied (not a bypass).
    expect(g.wasAdjudicated('tu_rm')).toBe(true);
    void ask;
  });

  it('MEMOIZED delegate: the hook and canUseTool for the SAME toolUseId ask AT MOST once', async () => {
    let resolveAsk!: (v: boolean) => void;
    const ask = vi.fn(() => new Promise<boolean>((r) => { resolveAsk = r; }));
    const { gate } = makeGate({ ask });
    const g = createSdkGate('run_1', gate);
    // Both seams race on the same tool call before the ask resolves.
    const hookDecision = g.adjudicate('tu_rm', 'rm -rf build');
    const canUseToolDecision = g.adjudicate('tu_rm', 'rm -rf build');
    resolveAsk(true);
    const [a, b] = await Promise.all([hookDecision, canUseToolDecision]);
    expect(a).toEqual({ behavior: 'allow' });
    expect(b).toEqual({ behavior: 'allow' });
    expect(ask).toHaveBeenCalledTimes(1); // ONE ask, shared in-flight promise
  });

  it('reason-class memoization: an approval waives every later ask of the SAME class', async () => {
    const { gate, ask } = makeGate();
    const g = createSdkGate('run_1', gate);
    await g.adjudicate('tu_rm_1', 'rm -rf build');
    const second = await g.adjudicate('tu_rm_2', 'rm -rf dist'); // same class, different toolUseId
    expect(second).toEqual({ behavior: 'allow' });
    expect(ask).toHaveBeenCalledTimes(1); // NOT re-asked
    expect(g.wasApprovedDestructive('tu_rm_2')).toBe(true);
  });

  it('reason-class memoization: a DIFFERENT class asks once even after another was approved', async () => {
    const { gate, ask } = makeGate();
    const g = createSdkGate('run_1', gate);
    await g.adjudicate('tu_rm', 'rm -rf build');
    await g.adjudicate('tu_push', 'git push --force origin main');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenNthCalledWith(1, 'recursive file deletion (rm -r)');
    expect(ask).toHaveBeenNthCalledWith(2, 'force push');
  });

  it('reason-class memoization: a denied class stays denied WITHOUT re-asking', async () => {
    const ask = vi.fn(async () => false);
    const { gate } = makeGate({ ask });
    const g = createSdkGate('run_1', gate);
    const first = await g.adjudicate('tu_rm_1', 'rm -rf build');
    const second = await g.adjudicate('tu_rm_2', 'rm -rf dist');
    expect(first.behavior).toBe('deny');
    expect(second).toEqual({ behavior: 'deny', message: gateDenyMessage('recursive file deletion (rm -r)') });
    expect(ask).toHaveBeenCalledTimes(1); // the class was already denied — no second ask
  });

  it('preApprovedReason (pre-dispatch confirm) waives the matching mid-run ask entirely', async () => {
    const { gate, ask, onCleared } = makeGate({ preApprovedReason: 'recursive file deletion (rm -r)' });
    const g = createSdkGate('run_1', gate);
    const d = await g.adjudicate('tu_rm', 'rm -rf build');
    expect(d).toEqual({ behavior: 'allow' });
    expect(ask).not.toHaveBeenCalled(); // the founder already approved this class before dispatch
    expect(onCleared).toHaveBeenCalledWith('tu_rm'); // still ledgered so the pump guard no-ops
    // A DIFFERENT class is still gated.
    await g.adjudicate('tu_push', 'git push --force origin main');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('force push');
  });

  it('Stop race: an ask that resolves false (Stop → resolveConfirm(runId,false)) denies, never throws', async () => {
    // The adapter's ask closure resolves FALSE synchronously when the pump signal aborts. The core
    // must treat that as a deny (the AbortError path runs separately in the adapter).
    const ask = vi.fn(async () => false);
    const { gate, onCleared } = makeGate({ ask });
    const g = createSdkGate('run_1', gate);
    await expect(g.adjudicate('tu_rm', 'rm -rf build')).resolves.toEqual({
      behavior: 'deny',
      message: gateDenyMessage('recursive file deletion (rm -r)'),
    });
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('gate-bypass tripwire: wasAdjudicated is FALSE for a toolUseId that never reached the gate', () => {
    const { gate } = makeGate();
    const g = createSdkGate('run_1', gate);
    // Nothing adjudicated yet — a Bash tool_result with this id means execution slipped the gate.
    expect(g.wasAdjudicated('tu_ghost')).toBe(false);
    expect(g.wasApprovedDestructive('tu_ghost')).toBe(false);
  });

  it('the deny message steers the model away from retrying destructive variants', () => {
    const msg = gateDenyMessage('recursive file deletion (rm -r)');
    expect(msg).toContain('recursive file deletion (rm -r)');
    expect(msg).toMatch(/do not run it or any destructive variant/i);
  });
});
