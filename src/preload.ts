// src/preload.ts — the ONLY bridge between the sandboxed renderer and MAIN. Exposes product
// contextBridge namespaces (window.companion / window.brain / window.memory) that wrap
// ipcRenderer.invoke (request/response) and ipcRenderer.on (push streams). Direct brain/vision
// invoke handles and debug helpers stay behind RORO_DEBUG_BRIDGE=1.
//
// Sandbox rules: this file may import 'electron' and the PURE src/shared/* modules (string
// consts + types, bundled by plugin-vite) — nothing that pulls Node builtins. NEVER expose
// ipcRenderer itself; only wrapped functions with structured-cloneable args. Every on()
// subscription returns an unsubscribe fn so the renderer can avoid listener leaks.
import { contextBridge, ipcRenderer } from 'electron';
import { CH } from './shared/ipc';
import type { TurnInput, BootstrapStatusMsg, ModelPullProgressMsg, WorkdirConfigMsg, MemoryHealthStatusMsg, ExecutorReadinessMsg } from './shared/ipc';
import type { ActionEvent } from './shared/events';
import type { Decision, DecideInput } from './shared/brain';
import type { RememberInput, MemoryRow, MemoryMatch, ProfileFactSourceView, ProfileFactView } from './shared/memory';
import type { FactProposalView } from './main/factProposals/types';

type AgentKindArg = 'codex' | 'claude';

// Renderer-safe runtime config injected by MAIN via webPreferences.additionalArguments.
// A sandboxed preload CAN read process.argv, so we parse the --roro-cfg= argv element
// here and expose it as window.RORO_CFG for src/renderer/config.ts to consume.
const cfgArg = process.argv.find((a) => a.startsWith('--roro-cfg='));
let roroCfg: Record<string, string | boolean> = {};
if (cfgArg) {
  try {
    roroCfg = JSON.parse(cfgArg.slice('--roro-cfg='.length));
  } catch {
    /* ignore malformed cfg — renderer falls back to empty defaults */
  }
}
const debugBridge = roroCfg.debugBridge === true || roroCfg.debugBridge === '1' || roroCfg.debugBridge === 'true';

/** Subscribe to a MAIN->renderer push channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const companion = {
  // PRIMARY entrypoint: full turn (recall -> decide -> dispatch). Events stream back.
  turnRun: (input: TurnInput): Promise<{ runId: string }> =>
    ipcRenderer.invoke(CH.turnRun, input),
  cancelTask: (runId?: string): Promise<void> =>
    ipcRenderer.invoke(CH.cancelTask, runId),
  moveWindowBy: (delta: { dx: number; dy: number }): Promise<void> =>
    ipcRenderer.invoke(CH.windowMoveBy, delta),
  // Push streams.
  onActionEvent: (cb: (e: ActionEvent) => void): (() => void) =>
    subscribe<ActionEvent>(CH.actionEvent, cb),
  onRunEnd: (cb: (p: { runId: string }) => void): (() => void) =>
    subscribe<{ runId: string }>(CH.runEnd, cb),
  // MAIN asks the renderer to open + focus the floating Ask input (⌘⇧Space summon).
  onFocusAsk: (cb: () => void): (() => void) =>
    subscribe<void>(CH.focusAsk, () => cb()),
  // Destructive-confirm: MAIN pushes a request; the renderer's confirm chip resolves it. This
  // invoke channel is the ONLY approval path — never a spoken/typed word.
  onConfirmRequest: (cb: (req: { runId: string; summary: string }) => void): (() => void) =>
    subscribe<{ runId: string; summary: string }>(CH.confirmRequest, cb),
  confirmResolve: (runId: string, approved: boolean): Promise<void> =>
    ipcRenderer.invoke(CH.confirmResolve, { runId, approved }),
  onCursor: (cb: (t: { x: number; y: number }) => void): (() => void) =>
    subscribe<{ x: number; y: number }>(CH.cursorMove, cb),
  // First-run bootstrap (M7b): MAIN pushes readiness; the renderer offers a one-click pull + sees progress.
  onBootstrapStatus: (cb: (s: BootstrapStatusMsg) => void): (() => void) =>
    subscribe<BootstrapStatusMsg>(CH.bootstrapStatus, cb),
  getBootstrapStatus: (): Promise<BootstrapStatusMsg | null> => ipcRenderer.invoke(CH.bootstrapStatusGet),
  refreshBootstrapStatus: (): Promise<BootstrapStatusMsg> => ipcRenderer.invoke(CH.bootstrapRefresh),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CH.openExternal, url),
  pullModels: (models: string[]): Promise<void> => ipcRenderer.invoke(CH.modelPull, models),
  onPullProgress: (cb: (p: ModelPullProgressMsg) => void): (() => void) =>
    subscribe<ModelPullProgressMsg>(CH.modelPullProgress, cb),
  getWorkdirConfig: (): Promise<WorkdirConfigMsg> => ipcRenderer.invoke(CH.configGet),
  chooseWorkdir: (): Promise<WorkdirConfigMsg> => ipcRenderer.invoke(CH.configChooseWorkdir),
  getExecutorReadiness: (agent?: AgentKindArg): Promise<ExecutorReadinessMsg> =>
    ipcRenderer.invoke(CH.executorReadinessGet, agent),
  onMemoryHealthStatus: (cb: (s: MemoryHealthStatusMsg) => void): (() => void) =>
    subscribe<MemoryHealthStatusMsg>(CH.memoryHealthStatus, cb),
  getMemoryHealthStatus: (): Promise<MemoryHealthStatusMsg | null> => ipcRenderer.invoke(CH.memoryHealthStatusGet),
} as {
  turnRun: (input: TurnInput) => Promise<{ runId: string }>;
  runTask?: (prompt: string, agent: AgentKindArg) => Promise<{ runId: string }>;
  cancelTask: (runId?: string) => Promise<void>;
  moveWindowBy: (delta: { dx: number; dy: number }) => Promise<void>;
  onActionEvent: (cb: (e: ActionEvent) => void) => () => void;
  onRunEnd: (cb: (p: { runId: string }) => void) => () => void;
  onFocusAsk: (cb: () => void) => () => void;
  onConfirmRequest: (cb: (req: { runId: string; summary: string }) => void) => () => void;
  confirmResolve: (runId: string, approved: boolean) => Promise<void>;
  onCursor: (cb: (t: { x: number; y: number }) => void) => () => void;
  onBootstrapStatus: (cb: (s: BootstrapStatusMsg) => void) => () => void;
  getBootstrapStatus: () => Promise<BootstrapStatusMsg | null>;
  refreshBootstrapStatus: () => Promise<BootstrapStatusMsg>;
  openExternal: (url: string) => Promise<void>;
  pullModels: (models: string[]) => Promise<void>;
  onPullProgress: (cb: (p: ModelPullProgressMsg) => void) => () => void;
  getWorkdirConfig: () => Promise<WorkdirConfigMsg>;
  chooseWorkdir: () => Promise<WorkdirConfigMsg>;
  getExecutorReadiness: (agent?: AgentKindArg) => Promise<ExecutorReadinessMsg>;
  onMemoryHealthStatus: (cb: (s: MemoryHealthStatusMsg) => void) => () => void;
  getMemoryHealthStatus: () => Promise<MemoryHealthStatusMsg | null>;
};

if (debugBridge) {
  // Direct executor dispatch bypasses the brain. Keep it available for deliberate debug sessions only.
  companion.runTask = (prompt: string, agent: AgentKindArg): Promise<{ runId: string }> =>
    ipcRenderer.invoke(CH.runTask, { prompt, agent });
}

const brain = {
  // DeepSeek reasoning_content deltas -> avatar 'thinking'.
  onReasoning: (cb: (delta: string) => void): (() => void) =>
    subscribe<string>(CH.brainReasoning, cb),
  // Optional live JSON-preview content deltas.
  onContent: (cb: (delta: string) => void): (() => void) =>
    subscribe<string>(CH.brainContent, cb),
} as {
  decide?: (input: DecideInput) => Promise<Decision>;
  describeScreen?: (input: { b64: string; mime: string }) => Promise<string>;
  embed?: (input: string | string[]) => Promise<number[] | number[][]>;
  onReasoning: (cb: (delta: string) => void) => () => void;
  onContent: (cb: (delta: string) => void) => () => void;
};

if (debugBridge) {
  brain.decide = (input: DecideInput): Promise<Decision> =>
    ipcRenderer.invoke(CH.brainDecide, input);
  brain.describeScreen = (input: { b64: string; mime: string }): Promise<string> =>
    ipcRenderer.invoke(CH.brainDescribeScreen, input);
  brain.embed = (input: string | string[]): Promise<number[] | number[][]> =>
    ipcRenderer.invoke(CH.brainEmbed, input);
}

const memory = {
  // Memory trust loop: see, fix, verify, source-check, and forget owner-scoped active facts.
  profile: (): Promise<ProfileFactView[]> => ipcRenderer.invoke(CH.memoryProfile),
  fixFact: (id: string, value: string): Promise<ProfileFactView> =>
    ipcRenderer.invoke(CH.memoryFixFact, { id, value }),
  verifyFact: (id: string): Promise<ProfileFactView> =>
    ipcRenderer.invoke(CH.memoryVerifyFact, id),
  factSource: (id: string): Promise<ProfileFactSourceView> =>
    ipcRenderer.invoke(CH.memoryFactSource, id),
  forget: (id: string): Promise<void> => ipcRenderer.invoke(CH.memoryForget, id),
  // Executor-facts pilot: these channels exist ONLY when RORO_EXECUTOR_FACTS is on (handlers are
  // unregistered otherwise — the invoke rejects and the panel section stays empty).
  proposals: (): Promise<FactProposalView[]> => ipcRenderer.invoke(CH.factProposalsGet),
  resolveProposal: (id: string, accept: boolean): Promise<{ ok: boolean; gone?: boolean }> =>
    ipcRenderer.invoke(CH.factProposalResolve, { id, accept }),
  onProposals: (cb: (msg: { count: number }) => void): (() => void) => subscribe(CH.factProposalsPush, cb),
} as {
  remember?: (input: Omit<RememberInput, 'owner_id'>) => Promise<MemoryRow>;
  recall?: (input: { query: string; k?: number; sessionId?: string }) => Promise<MemoryMatch[]>;
  profile: () => Promise<ProfileFactView[]>;
  fixFact: (id: string, value: string) => Promise<ProfileFactView>;
  verifyFact: (id: string) => Promise<ProfileFactView>;
  factSource: (id: string) => Promise<ProfileFactSourceView>;
  forget: (id: string) => Promise<void>;
  proposals: () => Promise<FactProposalView[]>;
  resolveProposal: (id: string, accept: boolean) => Promise<{ ok: boolean; gone?: boolean }>;
  onProposals: (cb: (msg: { count: number }) => void) => () => void;
};

if (debugBridge) {
  // Test harness/debug-only: product recall and writes go through MAIN/orchestrator, not renderer APIs.
  memory.remember = (input: Omit<RememberInput, 'owner_id'>): Promise<MemoryRow> =>
    ipcRenderer.invoke(CH.memoryRemember, input);
  memory.recall = (input: {
    query: string;
    k?: number;
    sessionId?: string;
  }): Promise<MemoryMatch[]> => ipcRenderer.invoke(CH.memoryRecall, input);
}

const vision = {
  // May reject with BlackFrameError — the renderer must catch and show onboarding.
  ask: (prompt: string): Promise<string> =>
    ipcRenderer.invoke(CH.visionAsk, prompt),
};

contextBridge.exposeInMainWorld('companion', companion);
contextBridge.exposeInMainWorld('brain', brain);
contextBridge.exposeInMainWorld('memory', memory);
if (debugBridge) {
  contextBridge.exposeInMainWorld('vision', vision);
}
contextBridge.exposeInMainWorld('RORO_CFG', roroCfg);
