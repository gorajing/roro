// src/main/run/gates.ts — the pre-dispatch gate pipeline (docs/plans/run-state-machine.md).
//
// ONE stage library, TWO literal compositions (pinned in gates.test.ts):
//   RUN_AGENT_GATES = [workdir, readiness, destructiveConfirm, stopCheckpoint, dispatch]
//   RUN_TASK_GATES  = [workdir, destructiveConfirm, stopCheckpoint, dispatch]
// readiness (+ the post-readiness narration) and factCtx are run_agent-only. Every pinned
// user-facing string lives here VERBATIM. A stage returning false has already ended the turn
// (terminal event + runEnd) — runGates short-circuits.

import type { AgentKind } from '../../shared/events';
import type { DispatchSection } from './runRegistry';
import type { Turn } from './turnState';

/** Everything a turn carries through the gates. `repo` is set by the workdir stage and
 *  `destructive` by the destructiveConfirm stage; the dispatch stage fails loud if a
 *  composition ever reaches it without them. */
export interface GateContext {
  readonly turn: Turn;
  readonly sessionId: string;
  /** The executor prompt AND the destructive-classification subject. */
  readonly task: string;
  readonly agent: AgentKind;
  /** run_agent-only: the brain's narration, spoken once readiness passes. */
  readonly narration?: string;
  /** run_agent-only: context for the post-run fact extraction. */
  readonly factCtx?: { transcript: string; narration: string; task: string };
  repo?: string;
  destructive?: boolean;
}

export type GateName = 'workdir' | 'readiness' | 'destructiveConfirm' | 'stopCheckpoint' | 'dispatch';

/** A stage: true = proceed; false = the stage ended the turn (event + runEnd already pushed). */
export type Gate = (ctx: GateContext) => Promise<boolean>;

export type StageLibrary = Record<GateName, Gate>;

export const RUN_AGENT_GATES: readonly GateName[] = [
  'workdir',
  'readiness',
  'destructiveConfirm',
  'stopCheckpoint',
  'dispatch',
];

export const RUN_TASK_GATES: readonly GateName[] = [
  'workdir',
  'destructiveConfirm',
  'stopCheckpoint',
  'dispatch',
];

/** Run a composition in order; short-circuit on the first stage that ends the turn. */
export async function runGates(names: readonly GateName[], stages: StageLibrary, ctx: GateContext): Promise<boolean> {
  for (const name of names) {
    if (!(await stages[name](ctx))) return false;
  }
  return true;
}

/** The effects the stages need — injected by the orchestrator facade (gates.ts stays pure of
 *  electron/executor imports, and the vi.mock landscape of the pin suites keeps working). */
export interface StageDeps {
  /** Fail-loud repo selection — THROWS when no repo is chosen (never silently touches cwd). */
  resolveRepo: () => string;
  getReadiness: (agent: AgentKind) => Promise<{ ready: boolean; message: string }>;
  /** The C1 destructive-confirm gate (15s default-deny; approval only via CH.confirmResolve). */
  confirmDestructive: (runId: string, task: string) => Promise<{ ok: boolean; destructive: boolean; reason?: string }>;
  emitNarration: (runId: string, text: string) => void;
  /** Terminal run.failed event + end the turn failed{error}. */
  failRun: (turn: Turn, error: string) => void;
  /** The stopCheckpoint consumer: synthetic run.failed('stopped') + ended{stopped}. */
  pushStopped: (turn: Turn) => void;
  isCleanTree: (repo: string) => Promise<boolean>;
  /** Open the dispatch critical section, or null when busy (the non-queuing refusal). */
  beginDispatch: (turn: Turn) => DispatchSection | null;
  /** Create the AbortController INSIDE the open section, commit the pump into the slot
   *  (synchronously), and start pumping. Resolves at DISPATCH — never awaited to terminal. */
  startPump: (ctx: GateContext, repo: string, destructive: boolean, section: DispatchSection) => void;
}

export function buildStages(deps: StageDeps): StageLibrary {
  return {
    // Choose the repo the agent will edit — FAIL LOUD if none is set, never silently touch cwd
    // (which is the app bundle / roro's own checkout). Surfaces as a terminal run.failed, not a crash.
    workdir: async (ctx) => {
      try {
        ctx.repo = deps.resolveRepo();
        return true;
      } catch (err) {
        deps.failRun(ctx.turn, (err as Error).message);
        return false;
      }
    },

    readiness: async (ctx) => {
      const readiness = await deps.getReadiness(ctx.agent);
      if (!readiness.ready) {
        deps.failRun(ctx.turn, readiness.message);
        return false;
      }
      // Speak the narration once the selected coding agent is actually startable.
      if (ctx.narration) deps.emitNarration(ctx.turn.runId, ctx.narration);
      return true;
    },

    // C1 destructive-confirm gate (BEFORE dispatch). A spoken/typed word can NEVER approve —
    // approval is only the dedicated CH.confirmResolve channel; 15s default-deny.
    destructiveConfirm: async (ctx) => {
      ctx.turn.to({ kind: 'confirming' });
      const confirm = await deps.confirmDestructive(ctx.turn.runId, ctx.task);
      if (!confirm.ok) {
        deps.emitNarration(ctx.turn.runId, `Skipping that — ${confirm.reason ?? "it was blocked"}.`);
        ctx.turn.end({ kind: 'refused', reason: confirm.reason ?? 'it was blocked' });
        return false;
      }
      ctx.destructive = confirm.destructive;
      return true;
    },

    // Honor a Stop that arrived during decide/confirm (pre-executor preempt).
    stopCheckpoint: async (ctx) => {
      if (ctx.turn.stopRequested) {
        deps.pushStopped(ctx.turn);
        return false;
      }
      return true;
    },

    // The section-protected single-executor dispatch. The DispatchSection stays open across the
    // (destructive) clean-tree check AND the synchronous pump commit, so no other turn can start
    // an executor in between — the clean-tree result is therefore fresh at dispatch (closes the
    // TOCTOU), and only one coding agent ever runs on the repo at a time.
    dispatch: async (ctx) => {
      const { repo, destructive } = ctx;
      if (repo === undefined || destructive === undefined) {
        // A composition without workdir/destructiveConfirm ahead of dispatch is a build bug — fail loud.
        throw new Error('[gates] dispatch ran before workdir/destructiveConfirm — bad composition');
      }
      const section = deps.beginDispatch(ctx.turn);
      if (!section) {
        deps.emitNarration(ctx.turn.runId, "I'm already working on something — Stop that first, or wait for it to finish.");
        ctx.turn.end({ kind: 'refused', reason: 'busy' });
        return false;
      }
      ctx.turn.to({ kind: 'dispatching' });
      try {
        if (destructive && !(await deps.isCleanTree(repo))) {
          deps.emitNarration(ctx.turn.runId, "Skipping that — the git tree isn't clean, so a destructive step couldn't be safely undone — commit or stash first.");
          ctx.turn.end({ kind: 'refused', reason: 'dirty tree' });
          return false;
        }
        // The in-section stopCheckpoint: a Stop that landed during the awaited clean-tree check.
        if (ctx.turn.stopRequested) {
          deps.pushStopped(ctx.turn);
          return false;
        }
        deps.startPump(ctx, repo, destructive, section); // commits the pump synchronously inside
        return true;
      } finally {
        section.close();
      }
    },
  };
}
