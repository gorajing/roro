// src/shared/ipc.ts — ALL IPC channel names (the const CH) + small shared payload types. Imported by main + preload.
// invoke = request/response; push = MAIN->renderer webContents.send (streams; invoke can't stream).
export type MicStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
export interface TurnInput { transcript: string; sessionId: string }

/** First-run readiness pushed MAIN->renderer (M7b) so the renderer can offer a one-click model download. */
export interface BootstrapStatusMsg {
  ready: boolean;
  /** Ollama itself isn't running — a download can't help until it's installed/started. */
  needsOllamaInstall: boolean;
  /** Essential models still missing (the core-loop download). */
  missing: { name: string; bytes: number }[];
  /** Total bytes for the essential download. */
  essentialBytes: number;
}

/** One model-pull progress tick pushed MAIN->renderer (M7b). */
export interface ModelPullProgressMsg {
  model: string;
  status: string;
  percent?: number;
  /** True on the final tick for the whole pull set (all requested models done). */
  done?: boolean;
  /** Set if the pull failed (fail-loud). */
  error?: string;
}

export const CH = {
  micStatus: 'mic:status', micRequest: 'mic:request',
  windowMoveBy: 'window:moveBy',
  focusAsk: 'window:focusAsk',
  cursorMove: 'cursor:move',
  micToggleMute: 'mic:toggleMute',
  turnRun: 'turn:run', runTask: 'orch:runTask', cancelTask: 'orch:cancelTask',
  actionEvent: 'orch:actionEvent', runEnd: 'orch:runEnd',
  confirmRequest: 'orch:confirmRequest', confirmResolve: 'orch:confirmResolve',
  brainDecide: 'brain:decide', brainReasoning: 'brain:reasoning', brainContent: 'brain:content',
  brainDescribeScreen: 'brain:describeScreen', brainEmbed: 'brain:embed',
  visionAsk: 'vision:ask', memoryRemember: 'memory:remember', memoryRecall: 'memory:recall',
  // Transparency + Forget (M8): list the facts roro knows about the owner, and hard-delete one.
  memoryProfile: 'memory:profile', memoryForget: 'memory:forget',
  // First-run bootstrap (M7b): MAIN pushes readiness; renderer invokes a one-click pull; MAIN streams progress.
  bootstrapStatus: 'bootstrap:status', modelPull: 'model:pull', modelPullProgress: 'model:pullProgress',
} as const;
