// src/main/orchestrator.ts — the MAIN-process orchestrator core.
//
// turnRun (the PRIMARY entrypoint): final transcript -> memory.recall -> brain.decide
// (streaming reasoning/content to the renderer) -> dispatch on Decision.command:
//   - run_agent      -> executor.run(...) for-await the ActionEvent stream
//   - answer/clarify -> push narration (a synthetic 'message' event), no executor
//   - capture_screen -> vision.ask -> decide() ONCE more with the screen, then re-dispatch
//
// runTask/cancelTask: direct executor dispatch (used after decide() already produced a
// command). One AbortController per run; cancelTask aborts it (the CLI executors translate
// an aborted signal into a run.failed('aborted')).
//
// STREAMING RULE (BUILD_GUIDE): ipcMain.handle is request/response only. ALL token/action
// streams go over webContents.send push channels (CH.actionEvent, CH.runEnd, CH.brainReasoning,
// CH.brainContent). The invoke promise resolves only with the final {runId}.
import { BrowserWindow, Notification } from 'electron';
import { CH } from '../shared/ipc';
import type { TurnInput } from '../shared/ipc';
import type { ActionEvent, AgentKind } from '../shared/events';
import { newRunId } from '../shared/events';
import type { Command, Decision, DecideInput } from '../shared/brain';
import type { MemoryKind } from '../shared/memory';
import { getExecutor } from '../executor';
import { loadBrain, loadMemory, loadVision } from './siblings';
import { getOwnerId } from './identity';
import { buildRecallContext } from './memoryContext';
import { extractAndStoreFact } from './factStore';
import { classifyDestructive } from './destructive';
import { requestConfirm, resolveConfirm } from './confirmGate';
import { isCleanTree } from './gitTree';
import type { FactExtractInput } from '../brain/extractFact';

const RECALL_K = 5;
const RECALL_MIN_SIMILARITY = 0.3;
const DEFAULT_AGENT: AgentKind = 'codex';
/** How long after an abort we force a terminal event so Stop is provably terminal. */
const STOP_WATCHDOG_MS = 1500;

/** Holds the active AbortController per runId so cancelTask can target a specific run. */
const activeRuns = new Map<string, AbortController>();
/** Turns the user preempted (Stop) before the executor registered — honored at the decide/confirm
 *  boundary and again right before dispatch, so a barge-in during decide/confirm never runs. */
const preemptedTurns = new Set<string>();
/** Every turn from mint to runEnd (covers decide/confirm/exec). Stop is only honored for an id in
 *  this set, which bounds preemptedTurns against stale/garbage ids from the public cancelTask IPC. */
const inFlightTurns = new Set<string>();
/** The most recently minted turn/task runId — the no-id Stop fallback, which must also reach a turn
 *  still in decide/confirm (when activeRuns is still empty). */
let lastTurnId: string | null = null;
/** Held synchronously across the clean-tree-check → dispatch critical section so that section can't
 *  interleave: it guarantees a destructive run's clean-tree result is fresh at dispatch (no TOCTOU). */
let dispatchLock = false;

/** Resolve the scratch git repo the coding agents run in. */
function workdir(): string {
  return process.env.COMPANION_WORKDIR ?? process.cwd();
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function pushEvent(e: ActionEvent): void {
  getWindow()?.webContents.send(CH.actionEvent, e);
}

function pushRunEnd(runId: string): void {
  preemptedTurns.delete(runId);
  inFlightTurns.delete(runId);
  getWindow()?.webContents.send(CH.runEnd, { runId });
}

/** Push the destructive-confirm request to the renderer (it shows a confirm chip). */
function pushConfirmRequest(req: { runId: string; summary: string }): void {
  getWindow()?.webContents.send(CH.confirmRequest, req);
}

/** Emit a synthetic terminal failure (preempt / stop) + runEnd for a turn. */
function pushStopped(runId: string, error = 'stopped'): void {
  pushEvent({ kind: 'run.failed', runId, ok: false, error, ts: Date.now() });
  pushRunEnd(runId);
}

/**
 * Step 1 of the destructive gate (used by BOTH run_agent and the brain-bypassing runTask): classify
 * the task, and if dangerous require explicit approval via the dedicated CH.confirmResolve channel
 * (15s default-DENY). NO lock is held here (the confirm can take up to 15s). The clean-tree check is
 * NOT here — it's done inside guardedDispatch so it's fresh at dispatch (see that fn).
 */
async function confirmIfDestructive(
  runId: string,
  task: string,
): Promise<{ ok: boolean; destructive: boolean; reason?: string }> {
  const verdict = classifyDestructive(task);
  if (!verdict.destructive) return { ok: true, destructive: false };
  const approved = await requestConfirm(runId, verdict.reason ?? 'destructive command', pushConfirmRequest);
  if (!approved) return { ok: false, destructive: true, reason: `it looked destructive (${verdict.reason}) and wasn't approved` };
  return { ok: true, destructive: true };
}

/**
 * Step 2: the lock-protected single-executor dispatch. Holds dispatchLock across the (destructive)
 * clean-tree check AND the synchronous dispatch(), so no other turn can start an executor in between
 * — the clean-tree result is therefore fresh at dispatch (closes the TOCTOU), and only one coding
 * agent ever runs on the repo at a time. Returns false (and emits a terminal) if it can't dispatch.
 */
async function guardedDispatch(runId: string, destructive: boolean, dispatch: () => void): Promise<boolean> {
  if (dispatchLock || activeRuns.size > 0) {
    emitNarration(runId, "I'm already working on something — Stop that first, or wait for it to finish.");
    pushRunEnd(runId);
    return false;
  }
  dispatchLock = true;
  try {
    if (destructive && !(await isCleanTree(workdir()))) {
      emitNarration(runId, "Skipping that — the git tree isn't clean, so a destructive step couldn't be safely undone — commit or stash first.");
      pushRunEnd(runId);
      return false;
    }
    if (preemptedTurns.has(runId)) {
      pushStopped(runId);
      return false;
    }
    dispatch(); // registers activeRuns synchronously before releasing the lock
    return true;
  } finally {
    dispatchLock = false;
  }
}

function pushReasoning(delta: string): void {
  getWindow()?.webContents.send(CH.brainReasoning, delta);
}

function pushContent(delta: string): void {
  getWindow()?.webContents.send(CH.brainContent, delta);
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

function terminalEventText(e: ActionEvent): string | undefined {
  if (e.kind === 'run.completed') return e.finalText;
  if (e.kind === 'run.failed') return e.error;
  return undefined;
}

/** Map a canonical event to the memory kind we persist it under. */
function memoryKind(e: ActionEvent): MemoryKind {
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
      owner_id: getOwnerId(),
      session_id: sessionId,
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
): Promise<string | undefined> {
  try {
    const memory = await loadMemory();
    // Owner-scoped recall: durable profile facts (getProfile) + episodic pgvector matches,
    // composed into a single LABELED memory string. Facts come first so they survive truncation.
    const { context, factCount, episodeCount } = await buildRecallContext(memory, {
      ownerId: getOwnerId(),
      sessionId,
      query,
      k: RECALL_K,
      minSimilarity: RECALL_MIN_SIMILARITY,
    });
    // Visible memory beat: recall emits no ActionEvent of its own, so surface it as a `status` event
    // (C1's one union addition) — a legible non-action beat, never assistant text — so the memory
    // round-trip shows on the timeline/captions and drives the memory avatar cue.
    pushEvent({
      kind: 'status',
      runId,
      text: `Memory: ${factCount} known ${factCount === 1 ? 'fact' : 'facts'}, ${episodeCount} related ${episodeCount === 1 ? 'item' : 'items'}`,
      ts: Date.now(),
    });
    return context;
  } catch (err) {
    console.error('[orchestrator] recall failed:', (err as Error).message);
    return undefined;
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
 * Dispatch the executor for a run, streaming every ActionEvent to the renderer and memory.
 * Owns the AbortController lifecycle for `runId`. Resolves when the stream ends.
 */
async function dispatchExecutor(
  runId: string,
  sessionId: string,
  prompt: string,
  agent: AgentKind,
  factCtx?: { transcript: string; narration: string; task: string },
): Promise<void> {
  const controller = new AbortController();
  let terminalSeen = false;
  let uiEnded = false;
  let slotReleased = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  activeRuns.set(runId, controller);

  // UI-terminal: push the terminal failure (if forced) + runEnd exactly once. Does NOT free the
  // executor slot — a watchdog-forced Stop is terminal to the USER while the possibly-still-alive
  // child keeps the single-executor slot, so guardedDispatch won't start a concurrent run.
  const endUi = (forcedError?: string): void => {
    if (uiEnded) return;
    uiEnded = true;
    if (forcedError && !terminalSeen) {
      pushEvent({ kind: 'run.failed', runId, ok: false, error: forcedError, ts: Date.now() });
      notifyJobDone(false, forcedError);
    }
    pushRunEnd(runId);
  };
  // Free the executor slot ONLY when the stream has truly ended (the child is confirmed gone), so a
  // new run never starts against a repo an orphaned child may still be mutating.
  const releaseSlot = (): void => {
    if (slotReleased) return;
    slotReleased = true;
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    activeRuns.delete(runId);
  };

  // Stop watchdog: if the child doesn't honor abort within STOP_WATCHDOG_MS, make the run terminal to
  // the UI (so Stop is provably terminal). It does NOT free the slot — the slot frees when the stream
  // truly ends. (The executor adapter SIGKILLs its child on abort, so the stream normally ends fast.)
  controller.signal.addEventListener(
    'abort',
    () => {
      watchdog = setTimeout(() => endUi('stopped'), STOP_WATCHDOG_MS);
    },
    { once: true },
  );

  try {
    const executor = getExecutor(agent);
    for await (const ev of executor.run({
      repo: workdir(),
      prompt,
      agent,
      signal: controller.signal,
    })) {
      // Already terminal (watchdog fired): DROP late events but keep DRAINING the stream until it
      // truly ends, so releaseSlot (in finally) only frees the single-executor slot once the child
      // has actually exited (the abort signal kills it). Breaking here would free the slot while an
      // aborted-but-slow child is still alive, admitting a concurrent run against the same repo.
      if (uiEnded) continue;
      // Re-stamp to the orchestrator's runId — the executors mint their OWN run ids, but activeRuns
      // (and so Stop/cancelTask) is keyed by THIS runId. Without this, a targeted Stop from the
      // renderer (which sees the event's runId) never finds the controller. One id per turn.
      const stamped = { ...ev, runId } as ActionEvent;
      pushEvent(stamped);
      // Native "job done" notification on terminal events — visible even when the
      // window is hidden or in floating mode.
      if (stamped.kind === 'run.completed' || stamped.kind === 'run.failed') {
        terminalSeen = true;
        notifyJobDone(stamped.kind === 'run.completed', terminalEventText(stamped));
        // Off-critical-path: extract AT MOST one durable fact from this turn (supersede-not-
        // overwrite). Fire-and-forget; this survives the Phase-B dispatch-return change.
        if (factCtx) {
          void runFactExtraction(sessionId, {
            transcript: factCtx.transcript,
            narration: factCtx.narration,
            task: factCtx.task,
            outcome: stamped.kind === 'run.completed' ? 'completed' : 'failed',
          });
        }
      }
      // Fire-and-forget memory persistence so it never stalls the event stream.
      void rememberEvent(sessionId, stamped);
    }
    if (!terminalSeen && !uiEnded && !controller.signal.aborted) {
      const completed: ActionEvent = {
        kind: 'run.completed',
        runId,
        ok: true,
        finalText: 'The coding agent finished.',
        ts: Date.now(),
      };
      pushEvent(completed);
      notifyJobDone(true, completed.finalText);
      void rememberEvent(sessionId, completed);
    }
  } catch (err) {
    // The executors normally translate failures into a run.failed event, but guard the
    // for-await itself so a thrown error still produces a terminal event + runEnd.
    if (!terminalSeen && !uiEnded) {
      pushEvent({
        kind: 'run.failed',
        runId,
        ok: false,
        error: (err as Error).message,
        ts: Date.now(),
      });
      notifyJobDone(false, (err as Error).message);
    }
  } finally {
    releaseSlot();
    endUi();
  }
}

/**
 * PRIMARY entrypoint. Runs a full voice turn for a final transcript.
 * Returns {runId} immediately-ish (after decide); the action stream arrives over push channels.
 */
export async function runTurn(input: TurnInput): Promise<{ runId: string }> {
  const { transcript, sessionId } = input;
  const runId = newRunId();
  lastTurnId = runId;
  inFlightTurns.add(runId);

  // Recall BEFORE storing this turn's transcript so the query isn't matched
  // against itself.
  const memory = await recallContext(transcript, sessionId, runId);

  // Persist what the USER said (not just the cat's paraphrase) so facts and
  // preferences stated by the user are recallable verbatim in later turns.
  await rememberUserSaid(sessionId, transcript);

  // Visible (and truthful) Nebius beat: DeepSeek produces the decision +
  // narration that follow, so name the brain doing the planning here.
  pushEvent({
    kind: 'message',
    runId,
    text: 'DeepSeek (Nebius) is planning the task…',
    ts: Date.now(),
  });

  let decision: Decision;
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
    pushRunEnd(runId);
    return { runId };
  }

  // Pre-executor preempt: a Stop/barge-in that arrived during decide is honored before we act.
  if (preemptedTurns.has(runId)) {
    pushStopped(runId);
    return { runId };
  }

  await actOnDecision(runId, input, decision, /* screenAlreadyCaptured */ false, memory);
  return { runId };
}

/**
 * Dispatch logic for a Decision; capture_screen may loop back into decide() exactly once.
 * `recalledMemory` is the recall computed in runTurn BEFORE this turn's transcript was stored —
 * the capture_screen re-decide reuses it rather than re-recalling (a second recall would
 * self-match the just-persisted transcript as top "RELATED PAST CONTEXT").
 */
async function actOnDecision(
  runId: string,
  input: TurnInput,
  decision: Decision,
  screenAlreadyCaptured: boolean,
  recalledMemory: string | undefined,
): Promise<void> {
  const { transcript, sessionId } = input;
  const command: Command = decision.command;

  // Always persist the narration the brain produced.
  void rememberNarration(sessionId, decision.narration);

  switch (command) {
    case 'answer':
    case 'clarify': {
      // Push the narration for the renderer to speak; no executor, no run.
      emitNarration(runId, decision.narration);
      void runFactExtraction(sessionId, { transcript, narration: decision.narration, outcome: 'answered' });
      pushRunEnd(runId);
      return;
    }

    case 'capture_screen': {
      if (screenAlreadyCaptured) {
        // Guard against an infinite capture loop: if the brain asks again, fall back to
        // answering with whatever narration it gave.
        emitNarration(runId, decision.narration);
        pushRunEnd(runId);
        return;
      }
      let screen: string;
      try {
        const [vision, brain] = await Promise.all([loadVision(), loadBrain()]);
        // Inject the brain's describeScreen so vision captures, then captions via Qwen2.5-VL.
        screen = await vision.askScreen(transcript, (img) => brain.describeScreen(img));
      } catch (err) {
        pushEvent({
          kind: 'run.failed',
          runId,
          ok: false,
          error: `vision failed: ${(err as Error).message}`,
          ts: Date.now(),
        });
        pushRunEnd(runId);
        return;
      }
      // Loop back into decide() ONCE with the screen description, then re-dispatch. Reuse the
      // pre-store recall (re-recalling here would self-match this turn's just-stored transcript).
      let next: Decision;
      try {
        next = await decideStreaming({ transcript, memory: recalledMemory, screen });
      } catch (err) {
        pushEvent({
          kind: 'run.failed',
          runId,
          ok: false,
          error: `decide (post-vision) failed: ${(err as Error).message}`,
          ts: Date.now(),
        });
        pushRunEnd(runId);
        return;
      }
      // Honor a Stop that arrived during the vision capture / second decide before recursing.
      if (preemptedTurns.has(runId)) {
        pushStopped(runId);
        return;
      }
      await actOnDecision(runId, input, next, /* screenAlreadyCaptured */ true, recalledMemory);
      return;
    }

    case 'run_agent': {
      // Speak the narration first, then run the coding agent on args.task.
      if (decision.narration) emitNarration(runId, decision.narration);
      const task =
        typeof decision.args.task === 'string'
          ? decision.args.task
          : transcript;
      const agent: AgentKind =
        decision.args.agent === 'claude' ? 'claude' : DEFAULT_AGENT;

      // C1 destructive-confirm gate (BEFORE dispatch). A spoken/typed word can NEVER approve —
      // approval is only the dedicated CH.confirmResolve channel; 15s default-deny.
      const confirm = await confirmIfDestructive(runId, task);
      if (!confirm.ok) {
        emitNarration(runId, `Skipping that — ${confirm.reason ?? "it was blocked"}.`);
        pushRunEnd(runId);
        return;
      }
      // Honor a Stop that arrived during decide/confirm (pre-executor preempt).
      if (preemptedTurns.has(runId)) {
        pushStopped(runId);
        return;
      }
      // Lock-protected single-executor dispatch (fresh clean-tree check inside; resolves at DISPATCH —
      // the action stream arrives over push channels; the AbortController registers synchronously).
      await guardedDispatch(runId, confirm.destructive, () => {
        void dispatchExecutor(runId, sessionId, task, agent, {
          transcript,
          narration: decision.narration,
          task,
        });
      });
      return;
    }
  }
}

async function rememberNarration(sessionId: string, text: string): Promise<void> {
  if (!text) return;
  try {
    const memory = await loadMemory();
    await memory.remember({
      owner_id: getOwnerId(),
      session_id: sessionId,
      kind: 'narration',
      text,
    });
  } catch (err) {
    console.error('[orchestrator] remember narration failed:', (err as Error).message);
  }
}

/** Persist the user's raw transcript so their stated facts/preferences recall verbatim. */
async function rememberUserSaid(sessionId: string, transcript: string): Promise<void> {
  if (!transcript.trim()) return;
  try {
    const memory = await loadMemory();
    await memory.remember({
      owner_id: getOwnerId(),
      session_id: sessionId,
      kind: 'observation',
      text: transcript,
    });
  } catch (err) {
    console.error('[orchestrator] remember user transcript failed:', (err as Error).message);
  }
}

/**
 * Off-critical-path: after a turn's terminal event, extract AT MOST one durable fact and
 * store it (supersede-not-overwrite). Fire-and-forget; never blocks or fails a turn.
 */
async function runFactExtraction(sessionId: string, input: FactExtractInput): Promise<void> {
  try {
    const [brain, memory] = await Promise.all([loadBrain(), loadMemory()]);
    const candidate = await brain.extractFact(input);
    await extractAndStoreFact(memory, candidate, {
      ownerId: getOwnerId(),
      sessionId,
      turnTs: Date.now(),
    });
  } catch (err) {
    console.error('[orchestrator] fact extraction failed:', (err as Error).message);
  }
}

/**
 * Direct executor dispatch (CH.runTask): bypass the brain. Returns {runId}; events stream
 * over the push channels. sessionId is unknown here (no turn context) so memory uses a
 * synthetic per-task session id derived from the runId.
 */
export async function runTask(prompt: string, agent: AgentKind): Promise<{ runId: string }> {
  const runId = newRunId();
  lastTurnId = runId;
  inFlightTurns.add(runId);
  // runTask bypasses the brain, so the destructive gate MUST run here too (or a renderer caller
  // could `rm -rf` unconfirmed). Gate then dispatch off the critical path; return {runId} now.
  void (async () => {
    const confirm = await confirmIfDestructive(runId, prompt);
    if (!confirm.ok) {
      emitNarration(runId, `Skipping that — ${confirm.reason ?? "it was blocked"}.`);
      pushRunEnd(runId);
      return;
    }
    if (preemptedTurns.has(runId)) {
      pushStopped(runId);
      return;
    }
    await guardedDispatch(runId, confirm.destructive, () => {
      void dispatchExecutor(runId, `task_${runId}`, prompt, agent);
    });
  })();
  return { runId };
}

/**
 * Stop / preempt a turn (CH.cancelTask). Marks the turn preempted (honored at the decide/confirm
 * boundary if no executor is registered yet) AND aborts the executor if it's running (which arms the
 * Stop watchdog). If runId is omitted, targets the most recent run.
 */
export function cancelTask(runId?: string): void {
  // Stop one turn: mark it preempted (honored at the decide/confirm boundary), DENY any pending
  // destructive-confirm immediately (so the turn ends promptly instead of hanging until the 15s
  // timeout), and abort its executor if running (arming the watchdog).
  const stop = (id: string): void => {
    if (!inFlightTurns.has(id)) return; // ignore stale/unknown ids -> bounds preemptedTurns
    preemptedTurns.add(id);
    resolveConfirm(id, false);
    activeRuns.get(id)?.abort();
  };
  if (runId) {
    stop(runId);
    return;
  }
  // No id: stop the most recent turn (it may still be in decide/confirm) AND abort the latest
  // running executor if that's a different turn — a no-id Stop shouldn't leave either running.
  if (lastTurnId) stop(lastTurnId);
  const latest = [...activeRuns.keys()].pop();
  if (latest && latest !== lastTurnId) activeRuns.get(latest)?.abort();
}

/** Resolve a destructive-confirm from the renderer's dedicated CH.confirmResolve. */
export { resolveConfirm as resolveDestructiveConfirm } from './confirmGate';

/** Abort every active run (called on app quit). */
export function cancelAllRuns(): void {
  for (const c of activeRuns.values()) c.abort();
  activeRuns.clear();
}
