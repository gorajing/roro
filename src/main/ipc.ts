// src/main/ipc.ts — registers every CH channel handler (ipcMain.handle, request/response).
//
// Streaming channels (CH.actionEvent, CH.runEnd, CH.brainReasoning, CH.brainContent) are
// PUSH-only (webContents.send) and are NOT registered here — they are emitted by the
// orchestrator / brain wiring. ipcMain.handle resolves with a final value only.
//
// Each handler's sibling call:
//   CH.windowMoveBy       -> current BrowserWindow.setPosition()
//   CH.turnRun            -> orchestrator.runTurn()            (recall+decide+dispatch)
//   CH.runTask            -> orchestrator.runTask()            -> executor.getExecutor() (debug bridge only)
//   CH.configGet          -> configStore.hydrateWorkdirConfig()
//   CH.configChooseWorkdir-> native folder picker + configStore.persistWorkdirChoice()
//   CH.executorReadinessGet -> executorReadiness.getExecutorReadiness()
//   CH.bootstrapRefresh   -> bootstrapRefresh.refreshBootstrapStatus()
//   CH.cancelTask         -> orchestrator.cancelTask()
//   CH.brainDecide        -> brain.decide()                    (sibling: src/brain; debug bridge only)
//   CH.brainDescribeScreen-> brain.describeScreen()            (sibling: src/brain; debug bridge only)
//   CH.brainEmbed         -> brain.embed()                     (sibling: src/brain; debug bridge only)
//   CH.memoryRemember     -> memory.remember()                 (sibling: src/memory; debug bridge only)
//   CH.memoryRecall       -> memory.recall()                   (sibling: src/memory; debug bridge only)
//   CH.memoryProfile      -> memory.profileFacts()             (main-owned trust loop)
//   CH.memoryFixFact      -> memory.fixFact()                  (main-owned trust loop)
//   CH.memoryVerifyFact   -> memory.verifyFact()               (main-owned trust loop)
//   CH.memoryFactSource   -> memory.factSource()               (main-owned trust loop)
//   CH.memoryHealthStatusGet -> current memory/keychain health (non-blocking renderer diagnostic)
//   CH.visionAsk          -> vision.askScreen()                (sibling: src/vision; debug bridge only)
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { CH } from '../shared/ipc';
import type { TurnInput, ModelPullProgressMsg, WorkdirConfigMsg, MemoryHealthStatusMsg, ExecutorReadinessMsg, BootstrapStatusMsg } from '../shared/ipc';
import { guardDeferredEnv } from '../shared/releaseChannel';
import { extractAndStoreFact } from '../core/orchestrator/factStore';
import type { FactProposalView } from '../core/orchestrator/factProposals/types';
import { pullModel } from '../core/brain/ollama';
import { DEFAULT_MODEL_SPECS } from '../core/orchestrator/bootstrapPlan';
import { isAllowedExternalUrl } from './openExternalGuard';
import { getMemoryHealthStatus } from '../core/orchestrator/memoryHealthStatusStore';
import type { Decision, DecideInput } from '../shared/brain';
import type { RememberEpisodeInput, Entry, MemoryMatch, ProfileFactSourceView, ProfileFactView } from '../shared/memory';
import { assertRendererEpisodeKind } from '../shared/memory';
import type { AgentKind } from '../shared/events';
import { runTurn, runTask, cancelTask, resolveDestructiveConfirm } from '../core/orchestrator/orchestrator';
import { loadBrain, loadMemory, loadVision } from '../core/orchestrator/siblings';
import { getOwnerId } from '../core/orchestrator/identity';
import { hydrateWorkdirConfig, persistWorkdirChoice } from '../core/orchestrator/configStore';
import { sendToWebContents } from './safeSend';
import { getExecutorReadiness } from '../core/orchestrator/executorReadiness';
import { refreshBootstrapStatus } from '../core/orchestrator/bootstrapRefresh';

/** Coerce a renderer-supplied agent arg to a valid AgentKind (default codex). */
function asAgentKind(v: unknown): AgentKind {
  return v === 'claude' ? 'claude' : 'codex';
}

function finitePixelDelta(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
}

function debugBridgeEnabled(): boolean {
  // Guarded: on a release/cohort build the deferred-v0 debug bridge is refused, so the privileged
  // runTask/brain.decide/memory/vision IPC handlers are never registered — even if the launch env sets
  // the flag. This is the REAL privilege boundary (preload only exposes wrappers over these handlers).
  return guardDeferredEnv(process.env).RORO_DEBUG_BRIDGE === '1';
}

export function registerIpcHandlers(): void {
  const debugBridge = debugBridgeEnabled();

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
  if (debugBridge) {
    ipcMain.handle(
      CH.runTask,
      (_e, arg: { prompt: string; agent?: AgentKind }): Promise<{ runId: string }> =>
        runTask(arg.prompt, asAgentKind(arg.agent)),
    );
  }
  ipcMain.handle(CH.cancelTask, (_e, runId?: string): void => cancelTask(runId));
  // Destructive-confirm: the renderer's confirm chip resolves a pending gate. This dedicated
  // invoke channel is the ONLY way to approve — a spoken/typed transcript can never reach it.
  ipcMain.handle(
    CH.confirmResolve,
    (_e, arg: { runId: string; approved: boolean }): void =>
      resolveDestructiveConfirm(arg.runId, Boolean(arg.approved)),
  );

  // ---- Packaged-app config / onboarding ----
  ipcMain.handle(CH.configGet, (): Promise<WorkdirConfigMsg> => hydrateWorkdirConfig(app.getPath('userData')));
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
      return hydrateWorkdirConfig(app.getPath('userData'));
    }

    return persistWorkdirChoice(app.getPath('userData'), result.filePaths[0], process.env);
  });
  ipcMain.handle(CH.executorReadinessGet, (_e, agent?: AgentKind): Promise<ExecutorReadinessMsg> =>
    getExecutorReadiness(asAgentKind(agent)));
  ipcMain.handle(CH.bootstrapRefresh, async (e): Promise<BootstrapStatusMsg> => {
    const refreshed = await refreshBootstrapStatus();
    sendToWebContents(e.sender, CH.bootstrapStatus, refreshed.status);
    return refreshed.status;
  });

  // ---- Brain (sibling: src/brain) ----
  // Direct brain invokes are a debug bridge. Product turns use CH.turnRun, while reasoning/content
  // updates are push-only streams emitted by the orchestrator/brain wiring.
  if (debugBridge) {
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
        // The real embed() is overloaded (string -> number[], string[] -> number[][]) and does not
        // accept the union directly — narrow before calling so each overload resolves.
        return Array.isArray(input) ? brain.embed(input) : brain.embed(input);
      },
    );
  }

  // ---- Memory (sibling: src/memory) — owner_id is injected MAIN-side, never trusted from renderer ----
  // Direct remember/recall are debug/test harness APIs. Product recall/write paths live in the orchestrator;
  // the product renderer only gets the trust-loop controls below.
  if (debugBridge) {
    ipcMain.handle(
      CH.memoryRemember,
      async (_e, input: Omit<RememberEpisodeInput, 'ownerId'>): Promise<Entry> => {
        assertRendererEpisodeKind(input.kind); // runtime guard: facts are derived internally; the renderer can't write them
        const memory = await loadMemory();
        return memory.remember({ ...input, ownerId: getOwnerId() });
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
  }
  // Transparency: the facts roro remembers about THIS owner (owner injected MAIN-side).
  ipcMain.handle(CH.memoryProfile, async (): Promise<ProfileFactView[]> => {
    const memory = await loadMemory();
    return memory.profileFacts(getOwnerId());
  });
  // Fix/verify/source: MAIN finds the active owner-scoped row and derives the fact key from storage;
  // renderer input is only the visible row id plus a replacement value.
  ipcMain.handle(
    CH.memoryFixFact,
    async (_e, input: { id: string; value: string }): Promise<ProfileFactView> => {
      const memory = await loadMemory();
      return memory.fixFact(getOwnerId(), input.id, input.value);
    },
  );
  ipcMain.handle(CH.memoryVerifyFact, async (_e, id: string): Promise<ProfileFactView> => {
    const memory = await loadMemory();
    return memory.verifyFact(getOwnerId(), id);
  });
  ipcMain.handle(CH.memoryFactSource, async (_e, id: string): Promise<ProfileFactSourceView> => {
    const memory = await loadMemory();
    return memory.factSource(getOwnerId(), id);
  });
  // Forget: hard-delete one of the owner's facts by id. forgetFact is owner-scoped + active-only, so a
  // renderer-supplied id can only ever delete one of THIS owner's currently-visible facts (never an
  // arbitrary or other-owner row).
  ipcMain.handle(CH.memoryForget, async (_e, id: string): Promise<void> => {
    const memory = await loadMemory();
    await memory.forgetFact(getOwnerId(), id);
  });
  ipcMain.handle(CH.memoryHealthStatusGet, (): MemoryHealthStatusMsg | null => getMemoryHealthStatus());

  // Executor-facts pilot (RORO_EXECUTOR_FACTS, deferred-v0): the proposal review flow. Registration
  // itself is the gate — flag off (or a release build, where guardDeferredEnv strips the key) means
  // these channels simply do not exist, same boundary as the debug bridge. ownerId is ALWAYS
  // injected MAIN-side; the renderer only ever supplies the visible proposal id + a boolean.
  const resolvingProposals = new Set<string>();
  if (guardDeferredEnv(process.env).RORO_EXECUTOR_FACTS === '1') {
    ipcMain.handle(CH.factProposalsGet, async (): Promise<FactProposalView[]> => {
      const { pendingProposals } = await import('../core/orchestrator/factProposals/runner');
      return pendingProposals.list().map((p) => ({
        id: p.id, key: p.key, value: p.value, evidence: p.evidence, agent: p.agent, createdAt: p.createdAt,
      }));
    });
    ipcMain.handle(
      CH.factProposalResolve,
      async (_e, input: { id: string; accept: boolean }): Promise<{ ok: boolean; gone?: boolean }> => {
        if (typeof input?.id !== 'string' || typeof input?.accept !== 'boolean') {
          throw new Error('factProposalResolve: expected { id: string, accept: boolean }');
        }
        const { pendingProposals } = await import('../core/orchestrator/factProposals/runner');
        // Double-resolve guard: two rapid clicks (or a click racing the push-refresh) must count as
        // ONE corroboration and ONE store. The second concurrent resolve for an id reports gone.
        if (resolvingProposals.has(input.id)) return { ok: true, gone: true };
        resolvingProposals.add(input.id);
        const ownerId = getOwnerId();
        const memory = await loadMemory();
        const trace = (stage: 'confirmed' | 'rejected', p: { key: string; agent: string; sessionId: string }): void =>
          memory.traceExtraction({ kind: 'propose', ownerId, sessionId: p.sessionId, runId: 'resolve', agent: p.agent, stage, factKey: p.key });
        try {
        if (!input.accept) {
          const p = pendingProposals.take(input.id);
          if (p) trace('rejected', p);
          return { ok: true, gone: !p };
        }
        // Peek-don't-take: a failing store must leave the proposal queued so the panel can retry.
        const p = pendingProposals.list().find((x) => x.id === input.id);
        if (!p) return { ok: true, gone: true };
        const outcome = await extractAndStoreFact(memory, { key: p.key, value: p.value }, {
          ownerId,
          sessionId: p.sessionId,
          turnTs: p.createdAt,
          provenance: { channel: 'executor', claimed_by: p.agent, evidence: p.evidence },
        });
        if (outcome === 'stored') {
          // The user's click is one corroboration — the same verb the panel's "Looks right" uses.
          await memory.reinforceFact({ ownerId, factKey: p.key }).catch(() => null);
        }
        pendingProposals.take(input.id); // only leaves the queue after a successful store
        trace('confirmed', p);
        return { ok: true };
        } finally {
          resolvingProposals.delete(input.id);
        }
      },
    );
  }

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
    const tick = (p: ModelPullProgressMsg): void => { sendToWebContents(e.sender, CH.modelPullProgress, p); };
    const ac = new AbortController();
    const onGone = (): void => ac.abort();
    e.sender.once('destroyed', onGone);
    try {
      for (const model of toPull) {
        await pullModel(model, (p) => tick({ model, status: p.status, percent: p.percent }), ac.signal);
      }
      tick({ model: '', status: 'success', done: true });
      const refreshed = await refreshBootstrapStatus();
      sendToWebContents(e.sender, CH.bootstrapStatus, refreshed.status);
    } catch (err) {
      tick({ model: '', status: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      if (!e.sender.isDestroyed()) e.sender.removeListener('destroyed', onGone);
    }
  });

  // ---- Vision (sibling: src/vision) ----
  // Direct screen capture from the renderer is debug-only. Product capture_screen runs inside the orchestrator.
  if (debugBridge) {
    ipcMain.handle(CH.visionAsk, async (_e, prompt: string): Promise<string> => {
      const [vision, brain] = await Promise.all([loadVision(), loadBrain()]);
      return vision.askScreen(prompt, (img) => brain.describeScreen(img));
    });
  }
}
