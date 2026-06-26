// src/main/ipc.ts — registers every CH channel handler (ipcMain.handle, request/response).
//
// Streaming channels (CH.actionEvent, CH.runEnd, CH.brainReasoning, CH.brainContent) are
// PUSH-only (webContents.send) and are NOT registered here — they are emitted by the
// orchestrator / brain wiring. ipcMain.handle resolves with a final value only.
//
// Each handler's sibling call:
//   CH.micStatus          -> mic.getMicStatus()                (this component)
//   CH.micRequest         -> mic.ensureMicAccess()             (this component)
//   CH.windowMoveBy       -> current BrowserWindow.setPosition()
//   CH.turnRun            -> orchestrator.runTurn()            (recall+decide+dispatch)
//   CH.runTask            -> orchestrator.runTask()            -> executor.getExecutor()
//   CH.configGet          -> configStore.hydrateWorkdirConfig()
//   CH.configChooseWorkdir-> native folder picker + configStore.persistWorkdirChoice()
//   CH.cancelTask         -> orchestrator.cancelTask()
//   CH.brainDecide        -> brain.decide()                    (sibling: src/brain)
//   CH.brainDescribeScreen-> brain.describeScreen()            (sibling: src/brain)
//   CH.brainEmbed         -> brain.embed()                     (sibling: src/brain)
//   CH.memoryRemember     -> memory.remember()                 (sibling: src/memory)
//   CH.memoryRecall       -> memory.recall()                   (sibling: src/memory)
//   CH.visionAsk          -> vision.askScreen()                (sibling: src/vision)
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { CH } from '../shared/ipc';
import type { MicStatus, TurnInput, ModelPullProgressMsg, WorkdirConfigMsg } from '../shared/ipc';
import { ollamaTags, pullModel } from '../brain/ollama';
import { bootstrapStatusFor, DEFAULT_MODEL_SPECS } from './bootstrapPlan';
import { isAllowedExternalUrl } from './openExternalGuard';
import { setBootstrapStatus } from './bootstrapStatusStore';
import type { Decision, DecideInput } from '../shared/brain';
import type { RememberInput, MemoryRow, MemoryMatch } from '../shared/memory';
import { assertRendererMemoryKind } from '../shared/memory';
import type { AgentKind } from '../shared/events';
import { getMicStatus, ensureMicAccess } from './mic';
import { runTurn, runTask, cancelTask, resolveDestructiveConfirm } from './orchestrator';
import { loadBrain, loadMemory, loadVision } from './siblings';
import { getOwnerId } from './identity';
import { hydrateWorkdirConfig, persistWorkdirChoice } from './configStore';

/** Coerce a renderer-supplied agent arg to a valid AgentKind (default codex). */
function asAgentKind(v: unknown): AgentKind {
  return v === 'claude' ? 'claude' : 'codex';
}

function finitePixelDelta(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
}

export function registerIpcHandlers(): void {
  // ---- Mic (this component) ----
  ipcMain.handle(CH.micStatus, (): MicStatus => getMicStatus());
  ipcMain.handle(CH.micRequest, (): Promise<MicStatus> => ensureMicAccess());

  // ---- Window chrome (floating Roro) ----
  ipcMain.handle(
    CH.windowMoveBy,
    (event, delta: { dx?: unknown; dy?: unknown }): void => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;

      const dx = finitePixelDelta(delta?.dx);
      const dy = finitePixelDelta(delta?.dy);
      if (dx === 0 && dy === 0) return;

      const [x, y] = win.getPosition();
      win.setPosition(x + dx, y + dy, false);
    },
  );

  // ---- Orchestrator ----
  ipcMain.handle(
    CH.turnRun,
    (_e, input: TurnInput): Promise<{ runId: string }> => runTurn(input),
  );
  ipcMain.handle(
    CH.runTask,
    (_e, arg: { prompt: string; agent?: AgentKind }): Promise<{ runId: string }> =>
      runTask(arg.prompt, asAgentKind(arg.agent)),
  );
  ipcMain.handle(CH.cancelTask, (_e, runId?: string): void => cancelTask(runId));
  // Destructive-confirm: the renderer's confirm chip resolves a pending gate. This dedicated
  // invoke channel is the ONLY way to approve — a spoken/typed transcript can never reach it.
  ipcMain.handle(
    CH.confirmResolve,
    (_e, arg: { runId: string; approved: boolean }): void =>
      resolveDestructiveConfirm(arg.runId, Boolean(arg.approved)),
  );

  // ---- Packaged-app config / onboarding ----
  ipcMain.handle(CH.configGet, (): Promise<WorkdirConfigMsg> => hydrateWorkdirConfig());
  ipcMain.handle(CH.configChooseWorkdir, async (event): Promise<WorkdirConfigMsg> => {
    const options: OpenDialogOptions = {
      title: 'Choose the project Roro should work on',
      buttonLabel: 'Choose Project',
      properties: ['openDirectory'],
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return hydrateWorkdirConfig();
    }

    return persistWorkdirChoice(app.getPath('userData'), result.filePaths[0], process.env);
  });

  // ---- Brain (sibling: src/brain) ----
  ipcMain.handle(
    CH.brainDecide,
    async (_e, input: DecideInput): Promise<Decision> => {
      const brain = await loadBrain();
      return brain.decide(input);
    },
  );
  ipcMain.handle(
    CH.brainDescribeScreen,
    async (_e, input: { b64: string; mime: string }): Promise<string> => {
      const brain = await loadBrain();
      return brain.describeScreen(input);
    },
  );
  ipcMain.handle(
    CH.brainEmbed,
    async (_e, input: string | string[]): Promise<number[] | number[][]> => {
      const brain = await loadBrain();
      return brain.embed(input);
    },
  );

  // ---- Memory (sibling: src/memory) — owner_id is injected MAIN-side, never trusted from renderer ----
  ipcMain.handle(
    CH.memoryRemember,
    async (_e, input: Omit<RememberInput, 'owner_id'>): Promise<MemoryRow> => {
      assertRendererMemoryKind(input.kind); // facts are derived internally; the renderer can't write them
      const memory = await loadMemory();
      return memory.remember({ ...input, owner_id: getOwnerId() });
    },
  );
  ipcMain.handle(
    CH.memoryRecall,
    async (
      _e,
      input: { query: string; k?: number; sessionId?: string },
    ): Promise<MemoryMatch[]> => {
      const memory = await loadMemory();
      return memory.recall({ ...input, ownerId: getOwnerId() });
    },
  );
  // Transparency: the facts roro knows about THIS owner (owner injected MAIN-side).
  ipcMain.handle(CH.memoryProfile, async (): Promise<MemoryRow[]> => {
    const memory = await loadMemory();
    return memory.getProfile(getOwnerId());
  });
  // Forget: hard-delete one of the owner's facts by id. forgetFact is owner-scoped + active-only, so a
  // renderer-supplied id can only ever delete one of THIS owner's currently-visible facts (never an
  // arbitrary or other-owner row).
  ipcMain.handle(CH.memoryForget, async (_e, id: string): Promise<void> => {
    const memory = await loadMemory();
    await memory.forgetFact(getOwnerId(), id);
  });

  // Open an external URL in the default browser — STRICTLY allowlisted (https + ollama.com only, see
  // isAllowedExternalUrl) so a renderer can't turn this into an arbitrary shell.openExternal (file://,
  // custom schemes, phishing).
  ipcMain.handle(CH.openExternal, async (_e, url: string): Promise<void> => {
    if (!isAllowedExternalUrl(url)) throw new Error(`openExternal: refusing non-allowlisted url: ${url}`);
    await shell.openExternal(url);
  });

  // First-run one-click model pull (M7b): pull each requested model via the local Ollama API, streaming
  // progress to the requesting renderer. On failure, push an error tick AND reject the invoke (fail-loud).
  ipcMain.handle(CH.modelPull, async (e, models: string[]): Promise<void> => {
    // Only pull KNOWN models — never let a renderer-supplied id drive an arbitrary network/disk pull.
    const known = new Set(DEFAULT_MODEL_SPECS.map((m) => m.name));
    const toPull = (Array.isArray(models) ? models : []).filter((m) => known.has(m));
    // Guard against a window closed mid-pull: don't send to a destroyed sender, and abort the (timeout-less)
    // pull so MAIN stops reading the multi-GB stream.
    const tick = (p: ModelPullProgressMsg): void => { if (!e.sender.isDestroyed()) e.sender.send(CH.modelPullProgress, p); };
    const ac = new AbortController();
    const onGone = (): void => ac.abort();
    e.sender.once('destroyed', onGone);
    try {
      for (const model of toPull) {
        await pullModel(model, (p) => tick({ model, status: p.status, percent: p.percent }), ac.signal);
      }
      tick({ model: '', status: 'success', done: true });
      const refreshed = bootstrapStatusFor({ kind: 'reachable', models: await ollamaTags() });
      setBootstrapStatus(refreshed);
      if (refreshed && !e.sender.isDestroyed()) e.sender.send(CH.bootstrapStatus, refreshed);
    } catch (err) {
      tick({ model: '', status: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      if (!e.sender.isDestroyed()) e.sender.removeListener('destroyed', onGone);
    }
  });

  // ---- Vision (sibling: src/vision) ----
  // THROWS BlackFrameError up to the renderer (which must catch + show onboarding).
  // askScreen captures the screen then calls the injected describe callback (brain) to caption.
  ipcMain.handle(CH.visionAsk, async (_e, prompt: string): Promise<string> => {
    const [vision, brain] = await Promise.all([loadVision(), loadBrain()]);
    return vision.askScreen(prompt, (img) => brain.describeScreen(img));
  });
}
