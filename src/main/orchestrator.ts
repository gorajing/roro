// src/main/orchestrator.ts — the MAIN-process orchestrator FACADE.
//
// The public surface is runTurn, runTask, cancelTask, cancelAllRuns, resolveDestructiveConfirm.
// The lifecycle itself is the typed run state machine under src/main/run/
// (docs/plans/run-state-machine.md):
//   - turnState.ts      the TURN machine — UI truth ("has runEnd been pushed?"): minted →
//                       deciding{1|2} → capturing → gating → confirming → dispatching → running
//                       → ended{cause}; `stopping` is preemption AS a phase, consumed by
//                       explicit stopCheckpoints
//   - runRegistry.ts    all live Turns + the single-executor SLOT (occupancy = a committed
//                       pump, freed only at stream drain) + the DispatchSection (the TOCTOU
//                       lock as a type) + the total requestStop
//   - pump.ts           the PUMP machine — process truth ("has the child's stream drained?"):
//                       flowing → finishing → draining → closed; Stop watchdog, runId re-stamp,
//                       mid-run destructive guard, no-verdict synthesis
//   - gates.ts          the pre-dispatch pipeline: RUN_AGENT_GATES / RUN_TASK_GATES composed
//                       from one stage library (workdir, readiness, destructiveConfirm,
//                       stopCheckpoint, dispatch)
//   - decisionRouter.ts the bounded two-pass decide loop (capture_screen re-decides ONCE;
//                       the pass lives in the Turn phase)
//
// runTurn (the PRIMARY entrypoint): final transcript -> memory.recall -> brain.decide
// (streaming reasoning/content to the renderer) -> routeDecision:
//   - run_agent      -> RUN_AGENT_GATES -> pumpRun over executor.run(...)'s ActionEvent stream
//   - answer/clarify -> push narration (a synthetic 'message' event), no executor
//   - capture_screen -> vision (locate fast path, or caption) -> decide() ONCE more, re-route
//
// runTask/cancelTask: direct executor dispatch bypassing the brain (RUN_TASK_GATES). One
// AbortController per run, created inside the dispatch section and owned by the pump;
// cancelTask -> registry.requestStop (the CLI executors translate an aborted signal into a
// run.failed('aborted')).
//
// STREAMING RULE (BUILD_GUIDE): ipcMain.handle is request/response only. ALL token/action
// streams go over guarded MAIN->renderer push channels (CH.actionEvent, CH.runEnd, CH.brainReasoning,
// CH.brainContent). The invoke promise resolves only with the final {runId}. This facade owns the
// IPC push sinks + the memory/fact side-effects it injects into the machine as deps.
import { Notification } from 'electron';
import { CH } from '../shared/ipc';
import type { TurnInput } from '../shared/ipc';
import { formatMemoryStatus, type ActionEvent, type AgentKind } from '../shared/events';
import { newRunId } from '../shared/events';
import type { Command, Decision, DecideInput } from '../shared/brain';
import type { EpisodeKind } from '../shared/memory';
import { getExecutor, type DestructiveGate } from '../executor';
import { loadBrain, loadMemory, loadVision, type MemoryModule } from './siblings';
import { getOwnerId } from './identity';
import { buildRecallContext } from './memoryContext';
import { extractAndStoreFact } from './factStore';
import { classifyDestructive, classifyDestructiveCommand } from './destructive';
import { requestConfirm, resolveConfirm } from './confirmGate';
import { isCleanTree } from './gitTree';
import { getRunRegistry, type DispatchSection } from './run/runRegistry';
import { pumpRun } from './run/pump';
import { buildStages, runGates, RUN_AGENT_GATES, RUN_TASK_GATES, type GateContext } from './run/gates';
import { routeDecision, type RouterDeps } from './run/decisionRouter';
import type { Turn } from './run/turnState';
import { resolveWorkdir, tryResolveWorkdir } from './workdir';
import { repoId as deriveRepoId } from '../memory2/repoId';
import { isPlausiblePreference, type FactExtractInput } from '../brain/extractFact';
import { buildDecisionPrompt } from '../brain/decisionPrompt';
import { sendToPetWindow } from './safeSend';
import { guardDeferredEnv } from '../shared/releaseChannel';
import { createDigestAccumulator } from './factProposals/digest';
import type { RunDigest } from './factProposals/types';
import { getExecutorReadiness } from './executorReadiness';

const RECALL_K = 5;
// memory2 is the recall authority: it blend-ranks (relevance + recency + importance) and guarantees
// recent rows (which carry cosine 0). A positive caller-side cosine floor would drop exactly those,
// nullifying the temporal-recall fix — so trust memory2's ranked top-k (0 = keep all it returns).
const RECALL_MIN_SIMILARITY = 0;

// Lifecycle state (turns, preemption, the single-executor slot, the dispatch section) lives in
// the typed run state machine: src/main/run/{turnState,runRegistry}.ts.

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function pushEvent(e: ActionEvent): void {
  sendToPetWindow(CH.actionEvent, e);
}

/** Push the destructive-confirm request to the renderer (it shows a confirm chip). */
function pushConfirmRequest(req: { runId: string; summary: string }): void {
  sendToPetWindow(CH.confirmRequest, req);
}

/** Emit a synthetic terminal failure (preempt / stop) + end the turn — the stopCheckpoint's
 *  consumer: it turns a pending `stopping` phase into ended{stopped}. */
function pushStopped(turn: Turn): void {
  pushEvent({ kind: 'run.failed', runId: turn.runId, ok: false, error: 'stopped', ts: Date.now() });
  turn.end({ kind: 'stopped' });
}

/**
 * Step 1 of the destructive gate (used by BOTH run_agent and the brain-bypassing runTask): classify
 * the task, and if dangerous require explicit approval via the dedicated CH.confirmResolve channel
 * (15s default-DENY). NO dispatch section is held here (the confirm can take up to 15s). The
 * clean-tree check is NOT here — the dispatch gate does it in-section so it's fresh at dispatch.
 */
async function confirmIfDestructive(
  runId: string,
  task: string,
): Promise<{ ok: boolean; destructive: boolean; reason?: string }> {
  const verdict = classifyDestructive(task);
  if (!verdict.destructive) return { ok: true, destructive: false };
  const approved = await requestConfirm(runId, verdict.reason ?? 'destructive command', pushConfirmRequest);
  if (!approved) return { ok: false, destructive: true, reason: `it looked destructive (${verdict.reason}) and wasn't approved` };
  // Return the classifier reason on APPROVAL too — startPump seeds it as the SDK gate's
  // preApprovedReason so the identical mid-run command isn't re-asked.
  return { ok: true, destructive: true, reason: verdict.reason };
}

function pushReasoning(delta: string): void {
  sendToPetWindow(CH.brainReasoning, delta);
}

function pushContent(delta: string): void {
  sendToPetWindow(CH.brainContent, delta);
}

/**
 * Fire a native OS notification when an agent run finishes. This is the reliable
 * "job done" signal even when the window is hidden, backgrounded, or in cat-only
 * floating mode (where the timeline/caption are not visible). Best-effort.
 */
function notifyJobDone(ok: boolean, detail?: string): void {
  try {
    if (!Notification.isSupported()) return;
    const body =
      (detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) ||
      (ok ? 'The coding agent finished.' : 'The coding agent stopped with an error.');
    new Notification({
      title: ok ? '✓ Roro — job complete' : '✗ Roro — job failed',
      body,
    }).show();
  } catch (err) {
    console.error('[orchestrator] notification failed:', (err as Error).message);
  }
}

function unapprovedDestructiveCommandReason(e: ActionEvent, destructiveApproved: boolean, repo?: string): string | null {
  if (destructiveApproved || e.kind !== 'command' || e.status !== 'started') return null;
  const verdict = classifyDestructiveCommand(e.command, repo);
  return verdict.destructive ? verdict.reason ?? 'destructive command' : null;
}

/** Map a canonical event to the episode kind we persist it under. */
function memoryKind(e: ActionEvent): EpisodeKind {
  switch (e.kind) {
    case 'message':
    case 'message.delta':
      return 'narration';
    case 'reasoning':
      return 'observation';
    default:
      return 'action';
  }
}

/** Short human summary of an event for the memory text column. */
function summarizeEvent(e: ActionEvent): string {
  switch (e.kind) {
    case 'run.started':
      return `run started (${e.agent})`;
    case 'turn.started':
      return 'turn started';
    case 'reasoning':
      return `reasoning: ${e.text.slice(0, 200)}`;
    case 'command':
      return `command ${e.status}: ${e.command.slice(0, 200)}`;
    case 'file_change':
      return `file_change ${e.status}: ${e.files.map((f) => `${f.op} ${f.path}`).join(', ')}`;
    case 'tool':
      return `tool ${e.status}: ${e.tool}${e.summary ? ` ${e.summary}` : ''}`;
    case 'message':
      return `message: ${e.text.slice(0, 200)}`;
    case 'message.delta':
      return e.text;
    case 'status':
      return `status: ${e.text.slice(0, 200)}`;
    case 'run.completed':
      return `run completed${e.finalText ? `: ${e.finalText.slice(0, 200)}` : ''}`;
    case 'run.failed':
      return `run failed: ${e.error}`;
  }
}

/** Persist a meaningful event to memory; best-effort (memory may be unavailable). */
async function rememberEvent(sessionId: string, e: ActionEvent): Promise<void> {
  // Skip noisy streaming deltas; persist concrete actions + final text only.
  if (e.kind === 'message.delta') return;
  try {
    const memory = await loadMemory();
    await memory.remember({
      ownerId: getOwnerId(),
      sessionId,
      kind: memoryKind(e),
      text: summarizeEvent(e),
      payload: e,
    });
  } catch (err) {
    // Memory is best-effort during a run; log loud but never abort the turn.
    console.error('[orchestrator] remember failed:', (err as Error).message);
  }
}

/**
 * Build the joined memory context string for a decide() call: recall top-k, keep matches
 * above the similarity floor, join their text. Returns undefined when memory is unavailable
 * or yields nothing (decide() treats memory as optional).
 */
async function recallContext(
  query: string,
  sessionId: string,
  runId: string,
  currentRepoId?: string,
): Promise<string | undefined> {
  try {
    const memory = await loadMemory();
    // Owner-scoped recall: durable profile facts (getProfile) + episodic vector matches,
    // composed into a single LABELED memory string. Facts come first so they survive truncation.
    // currentRepoId (M5b) boosts same-project episodes — "remembers you HERE" — without filtering out
    // cross-repo memories (a global preference still recalls everywhere, just unboosted elsewhere).
    const { context, factCount, episodeCount } = await buildRecallContext(memory, {
      ownerId: getOwnerId(),
      sessionId,
      query,
      k: RECALL_K,
      minSimilarity: RECALL_MIN_SIMILARITY,
      repoId: currentRepoId,
    });
    // Visible memory beat: recall emits no ActionEvent of its own, so surface it as a `status` event
    // (C1's one union addition) — a legible non-action beat, never assistant text — so the memory
    // round-trip shows on the timeline/captions and drives the memory avatar cue.
    pushEvent({
      kind: 'status',
      runId,
      text: formatMemoryStatus({ factCount, episodeCount }),
      ts: Date.now(),
    });
    return context;
  } catch (err) {
    console.error('[orchestrator] recall failed:', (err as Error).message);
    return undefined;
  }
}

/** Provider-aware label for the planning beat. Defensive: a brain-load failure here must not crash
 *  the turn — decideStreaming() will surface the real failure as a run.failed event right after. */
async function brainPlanningLabel(): Promise<string> {
  try {
    return (await loadBrain()).describeBrain();
  } catch {
    return 'the brain';
  }
}

/** Call the brain, streaming reasoning/content deltas to the renderer as they arrive. */
async function decideStreaming(input: DecideInput): Promise<Decision> {
  const brain = await loadBrain();
  return brain.decide(input, {
    onReasoning: (delta) => pushReasoning(delta),
    onContent: (delta) => pushContent(delta),
  });
}

/** Emit a synthetic final-message event so the renderer can speak a narration string. */
function emitNarration(runId: string, text: string): void {
  pushEvent({ kind: 'message', runId, text, ts: Date.now() });
}

/**
 * The dispatch gate's startPump: resolve the executor (the ONLY getExecutor call-site), create
 * the AbortController inside the open dispatch section, commit the pump into the slot, and hand
 * the stream to pumpRun (src/main/run/pump.ts — watchdog, re-stamp, destructive guard, no-verdict
 * synthesis live there). This caller owns WHAT flows into the sinks: the digest accumulator stays
 * HERE so the factProposals digest is built ONLY from the dispatched prompt + the run's own
 * events. The pump runs detached (resolves at DISPATCH); its stream drains in the background.
 */
function startPump(ctx: GateContext, repo: string, destructiveApproved: boolean, section: DispatchSection): void {
  const { turn, sessionId, agent, factCtx } = ctx;
  const prompt = ctx.task;
  const runId = turn.runId;
  const controller = new AbortController();
  // Executor-facts pilot (RORO_EXECUTOR_FACTS, spec: docs/plans/executor-facts-pilot.md): accumulate
  // a bounded digest of the run's OWN events for the post-run proposal ask. Dark unless the
  // deferred-env flag is on — no accumulation, no ask, zero cost.
  const digestAcc = guardDeferredEnv(process.env).RORO_EXECUTOR_FACTS === '1' ? createDigestAccumulator() : null;
  // The pre-execution destructive gate the SDK executor adjudicates (PreToolUse hook + canUseTool).
  // The CLI adapters IGNORE opts.gate, so injecting it always is inert for them; the SDK adapter
  // uses it to convert the post-hoc regex ABORT into a pre-execution default-deny confirm.
  //  - classify: the SAME classifier the post-hoc guard uses, bound to this repo.
  //  - ask: wraps confirmGate.requestConfirm UNCHANGED (15s default-DENY, dedicated channel).
  //  - preApprovedReason: the pre-dispatch confirm's reason class, so the identical mid-run command
  //    never re-asks.
  //  - onCleared: records the approved-destructive toolUseId in a ledger the post-hoc guard consults,
  //    so that guard is a no-op-by-construction for SDK runs (the gate already screened).
  const approvedItemIds = new Set<string>();
  const gate: DestructiveGate = {
    classify: (command) => classifyDestructiveCommand(command, repo),
    ask: (reason) => requestConfirm(runId, reason, pushConfirmRequest),
    preApprovedReason: ctx.destructiveReason,
    onCleared: (toolUseId) => { approvedItemIds.add(toolUseId); },
  };
  // Stop race: a Stop aborts the controller; deny any pending mid-run confirm SYNCHRONOUSLY so the
  // gate resolves deny (→ the adapter's AbortError path) instead of hanging to the 15s timeout. A
  // late renderer Approve for this runId is then confirmGate's unknown-id no-op.
  controller.signal.addEventListener('abort', () => resolveConfirm(runId, false), { once: true });
  section.commit(controller); // occupies the single-executor slot synchronously (turn -> running)
  const executor = getExecutor(agent);
  void pumpRun(
    runId,
    { events: executor.run({ repo, prompt, agent, signal: controller.signal, gate }), controller },
    {
      emit: (e) => {
        pushEvent(e);
        digestAcc?.see(e);
      },
      remember: (e) => {
        void rememberEvent(sessionId, e);
      },
      notify: notifyJobDone,
      // The post-hoc destructive guard (belt). For SDK runs a command/started event only reaches
      // here AFTER the gate cleared it (onCleared → the ledger), so this is a no-op-by-construction;
      // for CLI runs the ledger stays empty and the original destructiveApproved check is unchanged.
      // Keyed by itemId — never by command-string equality.
      guard: (e) =>
        e.kind === 'command' && e.status === 'started' && approvedItemIds.has(e.itemId)
          ? null
          : unapprovedDestructiveCommandReason(e, destructiveApproved, repo),
      onVerdict: (terminal) => {
        // Off-critical-path: extract AT MOST one durable fact from this turn (supersede-not-
        // overwrite). Fire-and-forget; this survives the Phase-B dispatch-return change.
        if (factCtx) {
          void runFactExtraction(sessionId, {
            transcript: factCtx.transcript,
            narration: factCtx.narration,
            task: factCtx.task,
            outcome: terminal.kind === 'run.completed' ? 'completed' : 'failed',
          });
        }
        // Executor-facts pilot: one post-run proposal ask, only on a COMPLETED run (a failed run
        // teaches about the repo, not the user). Fire-and-forget like runFactExtraction.
        if (digestAcc && terminal.kind === 'run.completed') {
          void proposeFactsFromRun(digestAcc.finish({ runId, sessionId, repo, agent, task: prompt, finalText: terminal.finalText }));
        }
      },
      endUi: (cause) => {
        turn.end(cause);
      },
      releaseSlot: () => {
        getRunRegistry().releasePump(runId);
      },
    },
  );
}

/** Terminal run.failed event + end the turn failed{error} — the gates' fail-loud sink. */
function failRun(turn: Turn, error: string): void {
  pushEvent({ kind: 'run.failed', runId: turn.runId, ok: false, error, ts: Date.now() });
  turn.end({ kind: 'failed', error });
}

/** The one stage library both compositions draw from (src/main/run/gates.ts owns the stage
 *  bodies + every pinned user-facing string; this facade injects the effects). */
const STAGES = buildStages({
  resolveRepo: () => resolveWorkdir(process.env, process.cwd()),
  getReadiness: (agent) => getExecutorReadiness(agent),
  confirmDestructive: confirmIfDestructive,
  emitNarration,
  failRun,
  pushStopped,
  isCleanTree: (repo) => isCleanTree(repo),
  beginDispatch: (turn) => getRunRegistry().tryBeginDispatch(turn),
  startPump,
});

/**
 * PRIMARY entrypoint. Runs a full voice turn for a final transcript.
 * Returns {runId} immediately-ish (after decide); the action stream arrives over push channels.
 */
export async function runTurn(input: TurnInput): Promise<{ runId: string }> {
  const { transcript, sessionId } = input;
  const runId = newRunId();
  const turn = getRunRegistry().mint(runId);

  // The project this turn belongs to (best-effort, NON-throwing — a no-workdir/answer turn still
  // recalls + remembers, just unscoped). Used to boost same-repo recall AND to stamp this turn's writes.
  const repoPath = tryResolveWorkdir(process.env, process.cwd());
  const currentRepoId = repoPath ? deriveRepoId(repoPath) : undefined;

  // Recall BEFORE storing this turn's transcript so the query isn't matched
  // against itself.
  const memory = await recallContext(transcript, sessionId, runId, currentRepoId);

  // Persist what the USER said (not just the cat's paraphrase) so facts and
  // preferences stated by the user are recallable verbatim in later turns — repo-stamped so a preference
  // stated while working in this project is recalled preferentially here.
  await rememberUserSaid(sessionId, transcript, repoPath);

  // Visible (and truthful) brain beat: name the model doing the planning, via describeBrain(),
  // so the label always reflects the actual configured local model.
  pushEvent({
    kind: 'message',
    runId,
    text: `${await brainPlanningLabel()} is planning the task…`,
    ts: Date.now(),
  });

  let decision: Decision;
  turn.to({ kind: 'deciding', pass: 1 });
  try {
    decision = await decideStreaming({ transcript, memory });
  } catch (err) {
    // Brain unavailable / failed: surface a terminal failure event so the avatar shows error.
    pushEvent({
      kind: 'run.failed',
      runId,
      ok: false,
      error: `decide failed: ${(err as Error).message}`,
      ts: Date.now(),
    });
    turn.end({ kind: 'failed', error: `decide failed: ${(err as Error).message}` });
    return { runId };
  }

  // Post-decide stopCheckpoint: a Stop/barge-in that arrived during decide is honored before we act.
  if (turn.stopRequested) {
    pushStopped(turn);
    return { runId };
  }

  await routeDecision(turn, input, decision, memory, ROUTER_DEPS);
  return { runId };
}

/** Draw the paw for a grounded box. BEST-EFFORT: never throws — the paw is a courtesy on top of the answer,
 *  and showing it is secondary to the grounding itself. The pointerOverlay (which imports electron) is loaded
 *  dynamically so the orchestrator's node unit tests don't statically pull in electron. */
async function showGroundedPoint(box: { x: number; y: number; w: number; h: number }, confidence: number): Promise<void> {
  try {
    const { showPointForBox } = await import('./pointerOverlay');
    await showPointForBox(box, confidence);
  } catch (err) {
    console.warn('[paw] show failed:', (err as Error).message);
  }
}

/** The decision router's effect sinks (src/main/run/decisionRouter.ts owns the bounded two-pass
 *  routing; this facade injects the vision/brain loads and the push/persist effects). */
const ROUTER_DEPS: RouterDeps = {
  rememberNarration,
  emitNarration,
  pushStatus: (runId, text) => {
    pushEvent({ kind: 'status', runId, text, ts: Date.now() });
  },
  failRun,
  pushStopped,
  runFactExtraction,
  captureDecide,
  decide: decideStreaming,
  ground: async (transcript) => {
    const [vision, brain] = await Promise.all([loadVision(), loadBrain()]);
    const img = await vision.captureScreen();
    return brain.groundTarget(img, transcript);
  },
  caption: async (transcript) => {
    const [vision, brain] = await Promise.all([loadVision(), loadBrain()]);
    return vision.askScreen(transcript, (img) => brain.describeScreen(img));
  },
  showGroundedPoint,
  delay,
  runAgentGates: (ctx) => runGates(RUN_AGENT_GATES, STAGES, ctx),
};

async function rememberNarration(sessionId: string, text: string): Promise<void> {
  if (!text) return;
  try {
    const memory = await loadMemory();
    await memory.remember({
      ownerId: getOwnerId(),
      sessionId,
      kind: 'narration',
      text,
    });
  } catch (err) {
    console.error('[orchestrator] remember narration failed:', (err as Error).message);
  }
}

/** Persist the user's raw transcript so their stated facts/preferences recall verbatim. repoPath stamps the
 *  project scope (M5b) so a preference stated while working here is recalled preferentially here. */
async function rememberUserSaid(sessionId: string, transcript: string, repoPath?: string): Promise<void> {
  if (!transcript.trim()) return;
  try {
    const memory = await loadMemory();
    await memory.remember({
      ownerId: getOwnerId(),
      sessionId,
      kind: 'observation',
      text: transcript,
      repoPath,
    });
  } catch (err) {
    console.error('[orchestrator] remember user transcript failed:', (err as Error).message);
  }
}

/**
 * OPT-IN, fire-and-forget capture of the DECIDE prompt + the generated task for a coding turn — the manual
 * "memory steered the work" proof (a recalled fact present in the prompt and reflected in the task). NOOP
 * unless RORO_TRACE=1, so it costs nothing on a normal run; the memory-laden prompt is written ONLY under
 * RORO_TRACE_DECIDE=plaintext (the tracer redacts it otherwise — see tracer.ts). Hung off the turn, never on
 * the latency path, and caught so it can never throw into the chokepoint.
 */
function captureDecide(
  sessionId: string,
  command: Command,
  transcript: string,
  memory: string | undefined,
  task: string | undefined,
): void {
  if (process.env.RORO_TRACE !== '1') return; // zero overhead when tracing is off — no loadMemory, no work
  void (async () => {
    try {
      const ownerId = getOwnerId();
      const memModule = await loadMemory();
      memModule.traceExtraction({
        kind: 'decide',
        ownerId,
        sessionId,
        command,
        prompt: buildDecisionPrompt({ transcript, memory }),
        task,
      });
    } catch (err) {
      console.error('[orchestrator] decide capture failed:', (err as Error).message);
    }
  })();
}

/**
 * Executor-facts pilot: fire one post-run proposal ask (docs/plans/executor-facts-pilot.md).
 * Lazy-imported so the pilot's module graph never loads unless a flagged run completes, and so
 * orchestrator tests can mock './factProposals' wholesale. Never throws into the chokepoint.
 */
async function proposeFactsFromRun(digest: RunDigest): Promise<void> {
  try {
    const { maybeProposeFacts, executorProposalSource } = await import('./factProposals');
    const ownerId = getOwnerId();
    const memory = await loadMemory().catch(() => undefined);
    await maybeProposeFacts(digest, {
      source: executorProposalSource(),
      getExisting: async () => {
        if (!memory) return null;
        try {
          return (await memory.profileFacts(ownerId)).map((f: { key: string; value: string }) => ({ key: f.key, value: f.value }));
        } catch {
          return null; // dedupe is best-effort; the user's confirm is the real gate
        }
      },
      notify: (count) => { sendToPetWindow(CH.factProposalsPush, { count }); },
      trace: (e) => memory?.traceExtraction({ kind: 'propose', ownerId, sessionId: digest.sessionId, ...e }),
    });
  } catch (err) {
    console.error('[orchestrator] fact proposal failed:', (err as Error).message);
  }
}

/**
 * Off-critical-path: after a turn's terminal event, extract AT MOST one durable fact and
 * store it (supersede-not-overwrite). Fire-and-forget; never blocks or fails a turn.
 */
async function runFactExtraction(sessionId: string, input: FactExtractInput): Promise<void> {
  let memory: MemoryModule | undefined;
  // The trace base (ids + turn outcome; no transcript/value text). Assigned INSIDE the try because
  // getOwnerId() can throw — keeping it caught preserves "fire-and-forget; never fails a turn" (both
  // callers void-dispatch with no .catch, so an escaping throw would be an unhandled rejection).
  let base: { kind: 'extract'; ownerId: string; sessionId: string; outcome: FactExtractInput['outcome'] } | undefined;
  try {
    const ownerId = getOwnerId();
    base = { kind: 'extract', ownerId, sessionId, outcome: input.outcome };
    memory = await loadMemory();
    // Classify WHY a fact did/didn't get written, so "0 known facts" is diagnosable. The gate is a pure
    // text match (isPlausiblePreference) — if it fails we never consult the model (and brain.extractFact
    // would gate to null anyway), so record 'gated' and stop.
    if (!isPlausiblePreference(input)) {
      memory.traceExtraction({ ...base, stage: 'gated', reason: 'no_preference_marker' });
      return;
    }
    const candidate = await (await loadBrain()).extractFact(input);
    if (!candidate) {
      // Gate passed but the 3B model still produced no fact — distinct from 'gated' for diagnosis.
      memory.traceExtraction({ ...base, stage: 'noop', reason: 'model_null' });
      return;
    }
    const stage = await extractAndStoreFact(memory, candidate, { ownerId, sessionId, turnTs: Date.now() });
    memory.traceExtraction({ ...base, stage, factKey: candidate.key });
  } catch (err) {
    // Fail loud verbatim (unchanged) AND record the failure for the trace (best-effort: base/memory may be
    // unset if getOwnerId()/loadMemory() threw — the console.error still preserves fail-loud).
    console.error('[orchestrator] fact extraction failed:', (err as Error).message);
    if (base) memory?.traceExtraction({ ...base, stage: 'failed', reason: (err as Error).message });
  }
}

/**
 * Direct executor dispatch (CH.runTask): bypass the brain. Returns {runId}; events stream
 * over the push channels. sessionId is unknown here (no turn context) so memory uses a
 * synthetic per-task session id derived from the runId.
 */
export async function runTask(prompt: string, agent: AgentKind): Promise<{ runId: string }> {
  const runId = newRunId();
  const turn = getRunRegistry().mint(runId);
  // runTask bypasses the brain, so the destructive gate MUST run here too (or a renderer caller
  // could `rm -rf` unconfirmed) — RUN_TASK_GATES keeps workdir (fail-loud repo) + destructive
  // confirm + stopCheckpoint + dispatch, and skips the run_agent-only readiness/narration.
  // Gate then dispatch off the critical path; return {runId} now.
  void (async () => {
    turn.to({ kind: 'gating' });
    await runGates(RUN_TASK_GATES, STAGES, {
      turn,
      sessionId: `task_${runId}`,
      task: prompt,
      agent,
    });
  })();
  return { runId };
}

/**
 * Stop / preempt a turn (CH.cancelTask). Delegates to the registry's total requestStop.
 * If runId is omitted, targets the most recent run.
 */
export function cancelTask(runId?: string): void {
  // requestStop is total: pre-dispatch phases flip to 'stopping' (honored at the next
  // stopCheckpoint) with any pending destructive-confirm DENIED immediately (so the turn ends
  // promptly instead of hanging until the 15s timeout); a running turn has its pump's controller
  // aborted (arming the watchdog); stale/unknown ids are ignored.
  const registry = getRunRegistry();
  if (runId) {
    registry.requestStop(runId);
    return;
  }
  // No id: stop the most recent turn (it may still be in decide/confirm) AND abort the latest
  // running executor if that's a different turn — a no-id Stop shouldn't leave either running.
  const last = registry.lastTurnId;
  if (last) registry.requestStop(last);
  const holder = registry.slotHolder();
  if (holder && holder !== last) registry.abortPump(holder);
}

/** Resolve a destructive-confirm from the renderer's dedicated CH.confirmResolve. */
export { resolveConfirm as resolveDestructiveConfirm } from './confirmGate';

/** Abort every active run (called on app quit). */
export function cancelAllRuns(): void {
  getRunRegistry().cancelAll();
}
