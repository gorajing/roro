// src/renderer/events/bridge.ts — narrow, defensive access to the preload bridges.
//
// We do NOT depend on src/types/companion.d.ts being present (another agent owns
// it). Instead we describe ONLY the members this component calls and reach them
// through a single cast. If companion.d.ts IS present its richer types apply
// elsewhere; here we keep our own minimal, self-sufficient view so this
// component's tsc is green in isolation.

import type { ActionEvent } from '../../shared/events';
import type { TurnInput, MicStatus, BootstrapStatusMsg, ModelPullProgressMsg, WorkdirConfigMsg } from '../../shared/ipc';

/** The slice of window.companion this component consumes. */
interface CompanionBridgeLike {
  onActionEvent(cb: (e: ActionEvent) => void): () => void;
  /** macOS TCC mic gate: status() reads it (no prompt); request() triggers the consent prompt (needs a user gesture). */
  mic?: { status(): Promise<MicStatus>; request(): Promise<MicStatus> };
  onRunEnd?(cb: (p: { runId: string }) => void): () => void;
  turnRun?(input: TurnInput): Promise<{ runId: string }>;
  /** Abort the most recent run when called with no id (orchestrator aborts the latest). */
  cancelTask?(runId?: string): Promise<void>;
  /** Move the current floating BrowserWindow by screen-pixel deltas. */
  moveWindowBy?(delta: { dx: number; dy: number }): Promise<void>;
  /** Subscribe to global demo mute toggles. */
  onMicToggleMute?(cb: () => void): () => void;
  /** MAIN asks the renderer to open + focus the floating Ask input (⌘⇧Space summon). */
  onFocusAsk?(cb: () => void): () => void;
  /** Destructive-confirm request from MAIN (the renderer shows a confirm chip). */
  onConfirmRequest?(cb: (req: { runId: string; summary: string }) => void): () => void;
  /** Resolve a destructive-confirm — the ONLY approval path. */
  confirmResolve?(runId: string, approved: boolean): Promise<void>;
  /** Subscribe to normalized cursor-gaze targets pushed from MAIN. */
  onCursor?(cb: (t: { x: number; y: number }) => void): () => void;
  /** First-run bootstrap (M7b): MAIN pushes readiness; the renderer offers a one-click model pull + sees progress. */
  onBootstrapStatus?(cb: (s: BootstrapStatusMsg) => void): () => void;
  /** Fetch the current readiness on demand — recovers a push missed before subscribing (the startup race). */
  getBootstrapStatus?(): Promise<BootstrapStatusMsg | null>;
  /** Open an allowlisted external URL (the Ollama download page) in the default browser. */
  openExternal?(url: string): Promise<void>;
  pullModels?(models: string[]): Promise<void>;
  onPullProgress?(cb: (p: ModelPullProgressMsg) => void): () => void;
  /** Current effective working repo source (env, persisted config, or unset). */
  getWorkdirConfig?(): Promise<WorkdirConfigMsg>;
  /** Open the native folder picker and persist the selected working repo. */
  chooseWorkdir?(): Promise<WorkdirConfigMsg>;
}

/** The slice of window.brain this component consumes. */
interface BrainBridgeLike {
  onReasoning?(cb: (delta: string) => void): () => void;
  /** Decision tokens streamed during decide(). The local Ollama default emits these (not
   *  reasoning_content), so they're what keeps the decide phase alive under the local brain. */
  onContent?(cb: (delta: string) => void): () => void;
}

interface BridgeWindow {
  companion?: CompanionBridgeLike;
  brain?: BrainBridgeLike;
}

function bridgeWindow(): BridgeWindow {
  // Single cast point. `unknown` first so this is valid no matter what (if
  // anything) the global Window already declares for these members.
  return window as unknown as BridgeWindow;
}

/** Returns window.companion if MAIN/preload has exposed it, else undefined. */
export function getCompanion(): CompanionBridgeLike | undefined {
  return bridgeWindow().companion;
}

/** Returns window.brain if MAIN/preload has exposed it, else undefined. */
export function getBrain(): BrainBridgeLike | undefined {
  return bridgeWindow().brain;
}
