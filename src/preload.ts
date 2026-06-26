// src/preload.ts — the ONLY bridge between the sandboxed renderer and MAIN. Exposes four
// contextBridge namespaces (window.companion / window.brain / window.memory / window.vision)
// that wrap ipcRenderer.invoke (request/response) and ipcRenderer.on (push streams).
//
// Sandbox rules: this file may import 'electron' and the PURE src/shared/* modules (string
// consts + types, bundled by plugin-vite) — nothing that pulls Node builtins. NEVER expose
// ipcRenderer itself; only wrapped functions with structured-cloneable args. Every on()
// subscription returns an unsubscribe fn so the renderer can avoid listener leaks.
import { contextBridge, ipcRenderer } from 'electron';
import { CH } from './shared/ipc';
import type { MicStatus, TurnInput, BootstrapStatusMsg, ModelPullProgressMsg, WorkdirConfigMsg } from './shared/ipc';
import type { ActionEvent } from './shared/events';
import type { Decision, DecideInput } from './shared/brain';
import type { RememberInput, MemoryRow, MemoryMatch, ProfileFactSourceView, ProfileFactView } from './shared/memory';

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

/** Subscribe to a MAIN->renderer push channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const companion = {
  mic: {
    status: (): Promise<MicStatus> => ipcRenderer.invoke(CH.micStatus),
    request: (): Promise<MicStatus> => ipcRenderer.invoke(CH.micRequest),
  },
  // PRIMARY entrypoint: full voice turn (recall -> decide -> dispatch). Events stream back.
  turnRun: (input: TurnInput): Promise<{ runId: string }> =>
    ipcRenderer.invoke(CH.turnRun, input),
  // Direct executor dispatch (brain already produced a command).
  runTask: (prompt: string, agent: AgentKindArg): Promise<{ runId: string }> =>
    ipcRenderer.invoke(CH.runTask, { prompt, agent }),
  cancelTask: (runId?: string): Promise<void> =>
    ipcRenderer.invoke(CH.cancelTask, runId),
  moveWindowBy: (delta: { dx: number; dy: number }): Promise<void> =>
    ipcRenderer.invoke(CH.windowMoveBy, delta),
  // Push streams.
  onActionEvent: (cb: (e: ActionEvent) => void): (() => void) =>
    subscribe<ActionEvent>(CH.actionEvent, cb),
  onRunEnd: (cb: (p: { runId: string }) => void): (() => void) =>
    subscribe<{ runId: string }>(CH.runEnd, cb),
  onMicToggleMute: (cb: () => void): (() => void) =>
    subscribe<void>(CH.micToggleMute, () => cb()),
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
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CH.openExternal, url),
  pullModels: (models: string[]): Promise<void> => ipcRenderer.invoke(CH.modelPull, models),
  onPullProgress: (cb: (p: ModelPullProgressMsg) => void): (() => void) =>
    subscribe<ModelPullProgressMsg>(CH.modelPullProgress, cb),
  getWorkdirConfig: (): Promise<WorkdirConfigMsg> => ipcRenderer.invoke(CH.configGet),
  chooseWorkdir: (): Promise<WorkdirConfigMsg> => ipcRenderer.invoke(CH.configChooseWorkdir),
};

const brain = {
  decide: (input: DecideInput): Promise<Decision> =>
    ipcRenderer.invoke(CH.brainDecide, input),
  describeScreen: (input: { b64: string; mime: string }): Promise<string> =>
    ipcRenderer.invoke(CH.brainDescribeScreen, input),
  embed: (input: string | string[]): Promise<number[] | number[][]> =>
    ipcRenderer.invoke(CH.brainEmbed, input),
  // DeepSeek reasoning_content deltas -> avatar 'thinking'.
  onReasoning: (cb: (delta: string) => void): (() => void) =>
    subscribe<string>(CH.brainReasoning, cb),
  // Optional live JSON-preview content deltas.
  onContent: (cb: (delta: string) => void): (() => void) =>
    subscribe<string>(CH.brainContent, cb),
};

const memory = {
  // owner_id is injected MAIN-side from the device identity; the renderer never supplies it.
  remember: (input: Omit<RememberInput, 'owner_id'>): Promise<MemoryRow> =>
    ipcRenderer.invoke(CH.memoryRemember, input),
  recall: (input: {
    query: string;
    k?: number;
    sessionId?: string;
  }): Promise<MemoryMatch[]> => ipcRenderer.invoke(CH.memoryRecall, input),
  // Memory trust loop: see, fix, verify, source-check, and forget owner-scoped active facts.
  profile: (): Promise<ProfileFactView[]> => ipcRenderer.invoke(CH.memoryProfile),
  fixFact: (id: string, value: string): Promise<ProfileFactView> =>
    ipcRenderer.invoke(CH.memoryFixFact, { id, value }),
  verifyFact: (id: string): Promise<ProfileFactView> =>
    ipcRenderer.invoke(CH.memoryVerifyFact, id),
  factSource: (id: string): Promise<ProfileFactSourceView> =>
    ipcRenderer.invoke(CH.memoryFactSource, id),
  forget: (id: string): Promise<void> => ipcRenderer.invoke(CH.memoryForget, id),
};

const vision = {
  // May reject with BlackFrameError — the renderer must catch and show onboarding.
  ask: (prompt: string): Promise<string> =>
    ipcRenderer.invoke(CH.visionAsk, prompt),
};

contextBridge.exposeInMainWorld('companion', companion);
contextBridge.exposeInMainWorld('brain', brain);
contextBridge.exposeInMainWorld('memory', memory);
contextBridge.exposeInMainWorld('vision', vision);
contextBridge.exposeInMainWorld('RORO_CFG', roroCfg);
contextBridge.exposeInMainWorld('COMPANION_CFG', roroCfg); // deprecated alias — back-compat
