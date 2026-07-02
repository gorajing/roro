// src/types/companion.d.ts — ambient typings for the contextBridge surfaces the renderer
// consumes. These mirror EXACTLY what src/preload.ts exposes via contextBridge. Imported
// implicitly by the renderer (TS global augmentation); never imported at runtime.
//
// The canonical ActionEvent is the 11-kind union from src/shared/events.ts (the flat
// electron-shell union in the BUILD_GUIDE prose is deleted per the central design decision).
import type { ActionEvent } from '../shared/events';
import type {
  TurnInput,
  WorkdirConfigMsg,
  ExecutorReadinessMsg,
  BootstrapStatusMsg,
  MemoryHealthStatusMsg,
  ModelPullProgressMsg,
} from '../shared/ipc';
import type { Decision, DecideInput } from '../shared/brain';
import type {
  RememberEpisodeInput,
  Entry,
  MemoryMatch,
  ProfileFactSourceView,
  ProfileFactView,
} from '../shared/memory';

export interface CompanionBridge {
  /**
   * PRIMARY orchestration entrypoint: hand MAIN a final transcript to run a full
   * turn (recall -> decide -> dispatch executor). Action/run events stream back over
   * onActionEvent / onRunEnd; this promise resolves only with the runId.
   */
  turnRun(input: TurnInput): Promise<{ runId: string }>;
  /** Debug bridge only: direct executor dispatch, bypassing the brain. */
  runTask?(prompt: string, agent: AgentKindArg): Promise<{ runId: string }>;
  /** SIGTERM/abort the active runner for a given runId (or the latest run if omitted). */
  cancelTask(runId?: string): Promise<void>;
  /** Move the current floating BrowserWindow by screen-pixel deltas. */
  moveWindowBy(delta: { dx: number; dy: number }): Promise<void>;
  /** Subscribe to the normalized executor event stream; returns an unsubscribe fn. */
  onActionEvent(cb: (e: ActionEvent) => void): () => void;
  /** Subscribe to run-finished markers; returns an unsubscribe fn. */
  onRunEnd(cb: (p: { runId: string }) => void): () => void;
  /** MAIN asks the renderer to open + focus the floating Ask input (⌘⇧Space summon). */
  onFocusAsk(cb: () => void): () => void;
  /** Destructive-confirm request from MAIN (the renderer shows a confirm chip). */
  onConfirmRequest(cb: (req: { runId: string; summary: string }) => void): () => void;
  /** Resolve a destructive-confirm — the ONLY approval path (never a spoken/typed word). */
  confirmResolve(runId: string, approved: boolean): Promise<void>;
  /** Cursor position pushed by MAIN for gaze tracking. */
  onCursor(cb: (target: { x: number; y: number }) => void): () => void;
  /** Latest first-run brain/model readiness snapshot. */
  getBootstrapStatus(): Promise<BootstrapStatusMsg | null>;
  /** Re-run MAIN's local brain/model readiness probe after the user starts Ollama or changes models. */
  refreshBootstrapStatus(): Promise<BootstrapStatusMsg>;
  /** Open a MAIN-allowlisted external URL in the default browser. */
  openExternal(url: string): Promise<void>;
  /** Pull known local Ollama models; progress streams through onPullProgress. */
  pullModels(models: string[]): Promise<void>;
  /** Subscribe to local model-pull progress ticks; returns an unsubscribe fn. */
  onPullProgress(cb: (p: ModelPullProgressMsg) => void): () => void;
  /** Current effective working repo source (env, persisted config, or unset). */
  getWorkdirConfig(): Promise<WorkdirConfigMsg>;
  /** Open the native project-folder picker and persist the chosen working repo. */
  chooseWorkdir(): Promise<WorkdirConfigMsg>;
  /** Product-safe local executor readiness for the first coding task. */
  getExecutorReadiness(agent?: AgentKindArg): Promise<ExecutorReadinessMsg>;
  /** Subscribe to non-blocking local memory/keychain health diagnostics; returns unsubscribe. */
  onMemoryHealthStatus(cb: (s: MemoryHealthStatusMsg) => void): () => void;
  /** Latest local memory/keychain health snapshot. */
  getMemoryHealthStatus(): Promise<MemoryHealthStatusMsg | null>;
}

export type AgentKindArg = 'codex' | 'claude';

export interface BrainBridge {
  /** Debug bridge only: direct brain decision invoke. Product turns use window.companion.turnRun. */
  decide?(input: DecideInput): Promise<Decision>;
  /** Debug bridge only: direct screen caption invoke. */
  describeScreen?(input: { b64: string; mime: string }): Promise<string>;
  /** Debug bridge only: direct embedding invoke. */
  embed?(input: string | string[]): Promise<number[] | number[][]>;
  /** DeepSeek reasoning_content token deltas -> avatar 'thinking'. Returns unsubscribe. */
  onReasoning(cb: (delta: string) => void): () => void;
  /** Optional live JSON-preview content deltas. Returns unsubscribe. */
  onContent(cb: (delta: string) => void): () => void;
}

export interface MemoryBridge {
  /** Debug bridge only: ownerId is injected MAIN-side from the device identity. */
  remember?(input: Omit<RememberEpisodeInput, 'ownerId'>): Promise<Entry>;
  /** Debug bridge only: direct semantic recall. Product recall is orchestrator-owned. */
  recall?(input: { query: string; k?: number; sessionId?: string }): Promise<MemoryMatch[]>;
  /** Renderer-safe transparency view: active owner-scoped facts only. */
  profile(): Promise<ProfileFactView[]>;
  /** Replace one active fact value; MAIN owns owner/key lookup. */
  fixFact(id: string, value: string): Promise<ProfileFactView>;
  /** Reinforce one active fact; MAIN owns owner/key lookup. */
  verifyFact(id: string): Promise<ProfileFactView>;
  /** Return safe local provenance for one active fact. */
  factSource(id: string): Promise<ProfileFactSourceView>;
  /** Hard-delete one owner-scoped active fact by id. */
  forget(id: string): Promise<void>;
}

export interface VisionBridge {
  /** MAIN captures the screen + Qwen2.5-VL; may reject with BlackFrameError (TCC denied). */
  ask(prompt: string): Promise<string>;
}

declare global {
  interface Window {
    companion: CompanionBridge;
    brain: BrainBridge;
    memory: MemoryBridge;
    /** Debug bridge only: direct renderer-initiated screen capture. */
    vision?: VisionBridge;
  }
}

export {};
