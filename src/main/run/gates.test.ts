import { describe, it, expect, vi } from 'vitest';
import {
  buildStages,
  runGates,
  RUN_AGENT_GATES,
  RUN_TASK_GATES,
  type GateContext,
  type GateName,
  type StageDeps,
  type StageLibrary,
} from './gates';
import { RunRegistry } from './runRegistry';
import { Turn } from './turnState';

// Pins for the gate pipeline (docs/plans/run-state-machine.md): the two compositions LITERALLY,
// runGates ordering + short-circuit, and each stage's contract — including every user-facing
// string VERBATIM (they moved from the orchestrator unchanged).

function makeDeps(overrides: Partial<StageDeps> = {}) {
  const registry = new RunRegistry({ pushRunEnd: vi.fn(), denyConfirm: vi.fn() });
  const deps: StageDeps = {
    resolveRepo: vi.fn(() => '/chosen/repo'),
    getReadiness: vi.fn(async () => ({ ready: true, message: 'ready' })),
    confirmDestructive: vi.fn(async () => ({ ok: true, destructive: false })),
    emitNarration: vi.fn(),
    failRun: vi.fn((turn: Turn, error: string) => { turn.end({ kind: 'failed', error }); }),
    pushStopped: vi.fn((turn: Turn) => { turn.end({ kind: 'stopped' }); }),
    isCleanTree: vi.fn(async () => true),
    beginDispatch: vi.fn((turn: Turn) => registry.tryBeginDispatch(turn)),
    startPump: vi.fn((_ctx, _repo, _destructive, section) => { section.commit(new AbortController()); }),
    ...overrides,
  };
  return { deps, registry, stages: buildStages(deps) };
}

function agentCtx(turn: Turn, extra: Partial<GateContext> = {}): GateContext {
  return { turn, sessionId: 's', task: 'edit a file', agent: 'codex', ...extra };
}

/** A turn in 'gating' — where both compositions start. */
function gatingTurn(registry: RunRegistry, runId = 'r1'): Turn {
  const turn = registry.mint(runId);
  turn.to({ kind: 'gating' });
  return turn;
}

describe('gate compositions (pinned literally)', () => {
  it('RUN_AGENT_GATES = [workdir, readiness, destructiveConfirm, stopCheckpoint, dispatch]', () => {
    expect(RUN_AGENT_GATES).toEqual(['workdir', 'readiness', 'destructiveConfirm', 'stopCheckpoint', 'dispatch']);
  });

  it('RUN_TASK_GATES = [workdir, destructiveConfirm, stopCheckpoint, dispatch] (no run_agent-only readiness)', () => {
    expect(RUN_TASK_GATES).toEqual(['workdir', 'destructiveConfirm', 'stopCheckpoint', 'dispatch']);
  });
});

describe('runGates', () => {
  it('runs the named stages in order and short-circuits at the first false', async () => {
    const ran: GateName[] = [];
    const stage = (name: GateName) => async (): Promise<boolean> => {
      ran.push(name);
      return name !== 'destructiveConfirm'; // deny at the confirm
    };
    const lib: StageLibrary = {
      workdir: stage('workdir'),
      readiness: stage('readiness'),
      destructiveConfirm: stage('destructiveConfirm'),
      stopCheckpoint: stage('stopCheckpoint'),
      dispatch: stage('dispatch'),
    };
    const { registry } = makeDeps();
    const ok = await runGates(RUN_AGENT_GATES, lib, agentCtx(gatingTurn(registry)));
    expect(ok).toBe(false);
    expect(ran).toEqual(['workdir', 'readiness', 'destructiveConfirm']); // stop/dispatch never ran
  });
});

describe('workdir stage', () => {
  it('sets ctx.repo from the fail-loud resolver', async () => {
    const { stages, registry } = makeDeps();
    const ctx = agentCtx(gatingTurn(registry));
    expect(await stages.workdir(ctx)).toBe(true);
    expect(ctx.repo).toBe('/chosen/repo');
  });

  it('a resolver throw fails the run with the resolver message (never touches cwd silently)', async () => {
    const { stages, deps, registry } = makeDeps({
      resolveRepo: vi.fn(() => { throw new Error('no repo chosen'); }),
    });
    const turn = gatingTurn(registry);
    expect(await stages.workdir(agentCtx(turn))).toBe(false);
    expect(deps.failRun).toHaveBeenCalledWith(turn, 'no repo chosen');
  });
});

describe('readiness stage (run_agent-only)', () => {
  it('fails the run with the readiness message BEFORE the narration is ever spoken', async () => {
    const { stages, deps, registry } = makeDeps({
      getReadiness: vi.fn(async () => ({ ready: false, message: 'Codex CLI not found.' })),
    });
    const turn = gatingTurn(registry);
    expect(await stages.readiness(agentCtx(turn, { narration: 'on it' }))).toBe(false);
    expect(deps.failRun).toHaveBeenCalledWith(turn, 'Codex CLI not found.');
    expect(deps.emitNarration).not.toHaveBeenCalled();
  });

  it('speaks the narration once the selected coding agent is actually startable', async () => {
    const { stages, deps, registry } = makeDeps();
    const turn = gatingTurn(registry);
    expect(await stages.readiness(agentCtx(turn, { narration: 'on it' }))).toBe(true);
    expect(deps.emitNarration).toHaveBeenCalledWith('r1', 'on it');
  });

  it('stays silent without a narration (the runTask shape)', async () => {
    const { stages, deps, registry } = makeDeps();
    expect(await stages.readiness(agentCtx(gatingTurn(registry)))).toBe(true);
    expect(deps.emitNarration).not.toHaveBeenCalled();
  });
});

describe('destructiveConfirm stage', () => {
  it('moves the turn to confirming, records the verdict destructiveness, and proceeds on approval', async () => {
    const { stages, registry } = makeDeps({
      confirmDestructive: vi.fn(async () => ({ ok: true, destructive: true })),
    });
    const turn = gatingTurn(registry);
    const ctx = agentCtx(turn);
    expect(await stages.destructiveConfirm(ctx)).toBe(true);
    expect(turn.phase).toEqual({ kind: 'confirming' });
    expect(ctx.destructive).toBe(true);
  });

  it('a denial narrates the pinned refusal VERBATIM and ends the turn refused', async () => {
    const { stages, deps, registry } = makeDeps({
      confirmDestructive: vi.fn(async () => ({
        ok: false,
        destructive: true,
        reason: "it looked destructive (rm -rf) and wasn't approved",
      })),
    });
    const turn = gatingTurn(registry);
    expect(await stages.destructiveConfirm(agentCtx(turn))).toBe(false);
    expect(deps.emitNarration).toHaveBeenCalledWith(
      'r1',
      "Skipping that — it looked destructive (rm -rf) and wasn't approved.",
    );
    expect(turn.phase).toEqual({
      kind: 'ended',
      cause: { kind: 'refused', reason: "it looked destructive (rm -rf) and wasn't approved" },
    });
  });

  it('a reasonless denial narrates the pinned fallback VERBATIM', async () => {
    const { stages, deps, registry } = makeDeps({
      confirmDestructive: vi.fn(async () => ({ ok: false, destructive: true })),
    });
    expect(await stages.destructiveConfirm(agentCtx(gatingTurn(registry)))).toBe(false);
    expect(deps.emitNarration).toHaveBeenCalledWith('r1', 'Skipping that — it was blocked.');
  });
});

describe('stopCheckpoint stage', () => {
  it('consumes a pending stop (stopping → ended{stopped})', async () => {
    const { stages, deps, registry } = makeDeps();
    const turn = gatingTurn(registry);
    registry.requestStop('r1');
    expect(await stages.stopCheckpoint(agentCtx(turn))).toBe(false);
    expect(deps.pushStopped).toHaveBeenCalledWith(turn);
  });

  it('passes through when no stop is pending', async () => {
    const { stages, deps, registry } = makeDeps();
    expect(await stages.stopCheckpoint(agentCtx(gatingTurn(registry)))).toBe(true);
    expect(deps.pushStopped).not.toHaveBeenCalled();
  });
});

describe('dispatch stage', () => {
  function dispatchReadyCtx(registry: RunRegistry, turn: Turn, destructive = false): GateContext {
    const ctx = agentCtx(turn);
    ctx.repo = '/chosen/repo';
    ctx.destructive = destructive;
    turn.to({ kind: 'confirming' });
    return ctx;
  }

  it('commits the pump inside the section (turn → running) and hands startPump the fresh values', async () => {
    const { stages, deps, registry } = makeDeps();
    const turn = gatingTurn(registry);
    const ctx = dispatchReadyCtx(registry, turn);
    expect(await stages.dispatch(ctx)).toBe(true);
    expect(deps.startPump).toHaveBeenCalledWith(ctx, '/chosen/repo', false, expect.anything());
    expect(turn.phase).toEqual({ kind: 'running' });
    expect(registry.slotHolder()).toBe('r1');
  });

  it('busy (slot occupied): narrates the pinned refusal VERBATIM, non-queuing', async () => {
    const { stages, deps, registry } = makeDeps();
    const first = gatingTurn(registry, 'a');
    await stages.dispatch(dispatchReadyCtx(registry, first));
    const second = registry.mint('b');
    second.to({ kind: 'gating' });
    expect(await stages.dispatch(dispatchReadyCtx(registry, second))).toBe(false);
    expect(deps.emitNarration).toHaveBeenCalledWith(
      'b',
      "I'm already working on something — Stop that first, or wait for it to finish.",
    );
    expect(second.phase).toEqual({ kind: 'ended', cause: { kind: 'refused', reason: 'busy' } });
    expect(deps.startPump).toHaveBeenCalledTimes(1);
  });

  it('a destructive run against a dirty tree narrates the pinned refusal VERBATIM (fresh check in-section)', async () => {
    const { stages, deps, registry } = makeDeps({ isCleanTree: vi.fn(async () => false) });
    const turn = gatingTurn(registry);
    expect(await stages.dispatch(dispatchReadyCtx(registry, turn, true))).toBe(false);
    expect(deps.isCleanTree).toHaveBeenCalledWith('/chosen/repo');
    expect(deps.emitNarration).toHaveBeenCalledWith(
      'r1',
      "Skipping that — the git tree isn't clean, so a destructive step couldn't be safely undone — commit or stash first.",
    );
    expect(deps.startPump).not.toHaveBeenCalled();
    expect(registry.slotHolder()).toBeNull(); // the abandoned section frees the lock
  });

  it('a non-destructive dispatch never consults the clean-tree check', async () => {
    const { stages, deps, registry } = makeDeps();
    await stages.dispatch(dispatchReadyCtx(registry, gatingTurn(registry), false));
    expect(deps.isCleanTree).not.toHaveBeenCalled();
  });

  it('the in-section stopCheckpoint consumes a Stop that landed during the awaited clean-tree check', async () => {
    const { registry, ...rest } = makeDeps();
    const turn = gatingTurn(registry);
    const deps: StageDeps = {
      ...rest.deps,
      isCleanTree: vi.fn(async () => {
        registry.requestStop('r1'); // the Stop races the await, inside the open section
        return true;
      }),
    };
    const stages = buildStages(deps);
    expect(await stages.dispatch(dispatchReadyCtx(registry, turn, true))).toBe(false);
    expect(deps.pushStopped).toHaveBeenCalledWith(turn);
    expect(deps.startPump).not.toHaveBeenCalled();
    expect(registry.slotHolder()).toBeNull();
  });

  it('FAILS LOUD on a composition that reaches dispatch without workdir/destructiveConfirm', async () => {
    const { stages, registry } = makeDeps();
    await expect(stages.dispatch(agentCtx(gatingTurn(registry)))).rejects.toThrow(/bad composition/);
  });
});
