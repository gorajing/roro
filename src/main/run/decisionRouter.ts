// src/main/run/decisionRouter.ts — the bounded two-pass decide loop
// (docs/plans/run-state-machine.md).
//
// Routes a Decision onto its command path. capture_screen may loop back into decide() exactly
// ONCE: the pass is read from the TURN phase (deciding{pass:1|2}), which replaces the old
// screenAlreadyCaptured boolean — a pass-2 capture_screen falls back to answering with the
// narration it gave. The locate fast path and the caption+re-decide path are the two branches
// of the capture stage, both behind the pinned tell → 500ms dwell → stopCheckpoint sequence.
// `recalledMemory` is the recall computed BEFORE this turn's transcript was stored — the pass-2
// re-decide reuses it rather than re-recalling (a second recall would self-match the
// just-persisted transcript as top "RELATED PAST CONTEXT").

import type { Command, DecideInput, Decision } from '../../shared/brain';
import { SCREEN_CAPTURE_STATUS_TEXT, type AgentKind } from '../../shared/events';
import type { TurnInput } from '../../shared/ipc';
import type { BrainModule } from '../siblings';
import type { GateContext } from './gates';
import type { Turn } from './turnState';

const DEFAULT_AGENT: AgentKind = 'codex';
/** Gives the renderer one visible beat to show the privacy tell before an on-demand screen capture. */
const SCREEN_CAPTURE_TELL_DWELL_MS = 500;

type GroundResult = Awaited<ReturnType<BrainModule['groundTarget']>>;

export interface RouterDeps {
  /** Persist the brain's narration (void-dispatched — never blocks the turn). */
  rememberNarration: (sessionId: string, text: string) => Promise<void>;
  emitNarration: (runId: string, text: string) => void;
  /** Push a `status` event (the pre-capture privacy tell). */
  pushStatus: (runId: string, text: string) => void;
  /** Terminal run.failed event + end the turn failed{error}. */
  failRun: (turn: Turn, error: string) => void;
  /** The stopCheckpoint consumer: synthetic run.failed('stopped') + ended{stopped}. */
  pushStopped: (turn: Turn) => void;
  /** Post-turn fact extraction (void-dispatched). */
  runFactExtraction: (
    sessionId: string,
    input: { transcript: string; narration: string; outcome: 'answered' },
  ) => Promise<void>;
  /** Opt-in RORO_TRACE decide capture — PRIMARY (pass-1) run_agent decisions only. */
  captureDecide: (
    sessionId: string,
    command: Command,
    transcript: string,
    memory: string | undefined,
    task: string | undefined,
  ) => void;
  /** The streaming decide (pass 2 carries the screen caption). */
  decide: (input: DecideInput) => Promise<Decision>;
  /** ONE vision call: capture + ground (the locate fast path). Errors are fail-loud. */
  ground: (transcript: string) => Promise<GroundResult>;
  /** ONE vision call: capture + caption (the non-locate screen turn). No grounding, no paw. */
  caption: (transcript: string) => Promise<string>;
  /** Best-effort paw for a grounded box — never throws. */
  showGroundedPoint: (box: NonNullable<GroundResult>['box'], confidence: number) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  /** Run the RUN_AGENT_GATES composition for this turn. */
  runAgentGates: (ctx: GateContext) => Promise<boolean>;
}

/**
 * Route the pass-1 Decision (and at most one pass-2 re-decide) to its end: a narrated answer,
 * a grounded point, or the run_agent gate pipeline. Every path ends the turn or hands it to
 * the gates.
 */
export async function routeDecision(
  turn: Turn,
  input: TurnInput,
  first: Decision,
  recalledMemory: string | undefined,
  deps: RouterDeps,
): Promise<void> {
  const { transcript, sessionId } = input;
  let decision = first;

  for (;;) {
    const command: Command = decision.command;

    // Always persist the narration the brain produced (each pass persists its own).
    void deps.rememberNarration(sessionId, decision.narration);

    switch (command) {
      case 'answer':
      case 'clarify': {
        // Push the narration for the renderer to speak; no executor, no run.
        deps.emitNarration(turn.runId, decision.narration);
        void deps.runFactExtraction(sessionId, { transcript, narration: decision.narration, outcome: 'answered' });
        turn.end({ kind: 'completed' });
        return;
      }

      case 'capture_screen': {
        if (turn.phase.kind === 'deciding' && turn.phase.pass === 2) {
          // Guard against an infinite capture loop: if the brain asks again on pass 2, fall
          // back to answering with whatever narration it gave. (One capture per turn — the
          // phase carries the pass, so no screenAlreadyCaptured flag.)
          deps.emitNarration(turn.runId, decision.narration);
          turn.end({ kind: 'completed' });
          return;
        }
        turn.to({ kind: 'capturing' });
        deps.pushStatus(turn.runId, SCREEN_CAPTURE_STATUS_TEXT);
        await deps.delay(SCREEN_CAPTURE_TELL_DWELL_MS);
        if (turn.stopRequested) {
          deps.pushStopped(turn);
          return;
        }

        // Fast locate path: a pure "point at X" turn (marked by the locate gate) grounds +
        // points with ONE vision call and answers briefly — no caption + re-decide (which
        // would double the vision latency).
        if (decision.args.locate === true) {
          let result: GroundResult;
          try {
            // Grounding IS the core op here — let its errors (vision model missing,
            // Ollama/API down) surface as a terminal failure (fail-loud), NOT get masked as
            // an ordinary "I can't find that".
            result = await deps.ground(transcript);
          } catch (err) {
            deps.failRun(turn, `vision failed: ${(err as Error).message}`);
            return;
          }
          // Post-grounding stopCheckpoint: honor a Stop that arrived during capture/grounding,
          // before showing the paw or speaking.
          if (turn.stopRequested) {
            deps.pushStopped(turn);
            return;
          }
          if (result) await deps.showGroundedPoint(result.box, result.confidence); // best-effort paw
          deps.emitNarration(turn.runId, result ? 'There it is.' : "I can't find that on your screen.");
          turn.end({ kind: 'completed' });
          return;
        }

        // A NON-locate screen turn ("what's this error on my screen?") just captions the frame
        // — no paw. The paw is a locate-turn thing (the fast path above); grounding here would
        // queue a second call on the same serialized vision model and add a full grounding
        // latency to an ordinary screen answer.
        let screen: string;
        try {
          screen = await deps.caption(transcript);
        } catch (err) {
          deps.failRun(turn, `vision failed: ${(err as Error).message}`);
          return;
        }
        // Loop back into decide() ONCE with the screen description, then re-route. Reuse the
        // pre-store recall (re-recalling here would self-match this turn's just-stored
        // transcript).
        turn.to({ kind: 'deciding', pass: 2 });
        try {
          decision = await deps.decide({ transcript, memory: recalledMemory, screen });
        } catch (err) {
          deps.failRun(turn, `decide (post-vision) failed: ${(err as Error).message}`);
          return;
        }
        // Post-re-decide stopCheckpoint: honor a Stop that arrived during the vision capture /
        // second decide before routing the new decision.
        if (turn.stopRequested) {
          deps.pushStopped(turn);
          return;
        }
        continue; // the ONE bounded loop-back (pass 2)
      }

      case 'run_agent': {
        // Opt-in proof capture (NOOP unless RORO_TRACE=1). Only the PRIMARY (pass-1) decision
        // is captured, so the reconstructed prompt from {transcript, recalledMemory} is
        // byte-exact; the pass-2 path is skipped (its prompt also carried the screen, which
        // isn't reconstructed here).
        const primary = turn.phase.kind === 'deciding' && turn.phase.pass === 1;
        turn.to({ kind: 'gating' });
        const task = typeof decision.args.task === 'string' ? decision.args.task : transcript;
        if (primary) {
          deps.captureDecide(
            sessionId,
            command,
            transcript,
            recalledMemory,
            typeof decision.args.task === 'string' ? decision.args.task : undefined,
          );
        }
        const agent: AgentKind = decision.args.agent === 'claude' ? 'claude' : DEFAULT_AGENT;
        await deps.runAgentGates({
          turn,
          sessionId,
          task,
          agent,
          narration: decision.narration,
          factCtx: { transcript, narration: decision.narration, task },
        });
        return;
      }

      default: {
        // Exhaustiveness guard: adding a Command must be handled above. The never-assignment
        // fails the build until it is; if that is ever bypassed at runtime, END the run (a
        // missing case used to fall through to a silent return — a hung run that never pushes
        // run-end).
        const _exhaustive: never = command;
        deps.failRun(turn, `unhandled command: ${String(_exhaustive)}`);
        return;
      }
    }
  }
}
