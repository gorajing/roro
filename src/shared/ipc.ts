// src/shared/ipc.ts — ALL IPC channel names (the const CH) + small shared payload types. Imported by main + preload.
// invoke = request/response; push = guarded MAIN->renderer send (streams; invoke can't stream).
// NOTE: the mic channels (mic:status / mic:request / mic:toggleMute) were voice-only and left with the
// voice stack — packages/voice/README.md documents how they come back at re-integration.
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
  /** Optional startup diagnostic for not-ready states that do not have a one-click action. */
  message?: string;
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

export type MemoryHealthState = 'checking' | 'ok' | 'degraded';
export type MemoryHealthStatusReason = 'keychain-unavailable' | 'memory-locked' | 'store-unavailable' | 'unknown';

/** Non-blocking memory health pushed MAIN->renderer; unlike BootstrapStatusMsg, it must not gate turns. */
export interface MemoryHealthStatusMsg {
  state: MemoryHealthState;
  checkedAt: number;
  reason?: MemoryHealthStatusReason;
  message?: string;
}

export type WorkdirConfigSource = 'env' | 'config' | 'unset';

export interface WorkdirConfigMsg {
  workdir?: string;
  source: WorkdirConfigSource;
}

export type ExecutorReadinessSource = 'env' | 'path' | 'common' | 'bare';

/** Read-only product readiness for the local executor CLI used by coding turns. */
export interface ExecutorReadinessMsg {
  ready: boolean;
  agent: 'codex' | 'claude';
  command: string;
  envVar: string;
  path: string;
  source: ExecutorReadinessSource;
  message: string;
}

export const CH = {
  // Executor-facts pilot (RORO_EXECUTOR_FACTS, deferred-v0): proposal review flow. Handlers register
  // ONLY when the flag is on; factProposalsPush is MAIN->renderer (chip), the others invoke/handle.
  factProposalsGet: 'factProposals:get',
  factProposalResolve: 'factProposals:resolve',
  factProposalsPush: 'factProposals:push',
  windowMoveBy: 'window:moveBy',
  focusAsk: 'window:focusAsk',
  cursorMove: 'cursor:move',
  turnRun: 'turn:run', runTask: 'orch:runTask', cancelTask: 'orch:cancelTask',
  actionEvent: 'orch:actionEvent', runEnd: 'orch:runEnd',
  confirmRequest: 'orch:confirmRequest', confirmResolve: 'orch:confirmResolve',
  brainDecide: 'brain:decide', brainReasoning: 'brain:reasoning', brainContent: 'brain:content',
  brainDescribeScreen: 'brain:describeScreen', brainEmbed: 'brain:embed',
  visionAsk: 'vision:ask', memoryRemember: 'memory:remember', memoryRecall: 'memory:recall',
  // Memory trust loop: list/fix/verify/source-check/forget owner-scoped active facts.
  memoryProfile: 'memory:profile', memoryFixFact: 'memory:fixFact',
  memoryVerifyFact: 'memory:verifyFact', memoryFactSource: 'memory:factSource',
  memoryForget: 'memory:forget',
  // Non-blocking memory/keychain readiness: warn the renderer, but never block a turn.
  memoryHealthStatus: 'memory:healthStatus', memoryHealthStatusGet: 'memory:healthStatusGet',
  // First-run bootstrap (M7b): MAIN pushes readiness (and serves it on demand to recover a missed push);
  // renderer can ask MAIN to re-run the readiness probe after the user starts Ollama; MAIN streams pulls.
  bootstrapStatus: 'bootstrap:status', bootstrapStatusGet: 'bootstrap:statusGet',
  bootstrapRefresh: 'bootstrap:refresh',
  modelPull: 'model:pull', modelPullProgress: 'model:pullProgress',
  // Packaged-app onboarding (Phase 1): persisted working repo lives in userData/config.json.
  configGet: 'config:get', configChooseWorkdir: 'config:chooseWorkdir',
  // First-task readiness: product-safe check that the default local executor can start.
  executorReadinessGet: 'executor:readinessGet',
  // Open an allowlisted external URL in the default browser (the Ollama download page).
  openExternal: 'shell:openExternal',
} as const;
