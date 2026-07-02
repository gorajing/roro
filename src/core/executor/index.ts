// src/executor/index.ts — the single public surface of the executor adapter.
//
// Selects a backend Executor by AgentKind. Both backends yield the IDENTICAL canonical
// ActionEvent union (src/shared/events.ts) so the renderer/Brain/Avatar treat them the
// same. Defaults to codex.
import { AgentKind, Executor } from '../../shared/events';
import { guardDeferredEnv } from '../../shared/releaseChannel';
import { CodexExecutor } from './codex';
import { ClaudeExecutor } from './claude';
import { ClaudeSdkExecutor } from './claudeSdk';

export { CodexExecutor, runCodex, mapCodexThreadEvent } from './codex';
export {
  ClaudeExecutor,
  runClaude,
  mapClaudeMessage,
  mapClaudeMessageBlocks,
  mapClaudeStreamEvent,
  newClaudeCorrelation,
} from './claude';
export { ClaudeSdkExecutor, runClaudeSdk, buildSdkOptions, sdkMessagesToEvents } from './claudeSdk';
export type { DestructiveGate } from './claudeSdkGate';

type Env = Record<string, string | undefined>;

/**
 * Resolve the backend for an agent. The Agent-SDK executor (claude only) is FLAG-GATED DARK behind
 * the deferred-v0 flag RORO_SDK_EXECUTOR, read ONLY through guardDeferredEnv so a release/cohort
 * build (where the guard strips every deferred key) can NEVER select it from a launch-time env — the
 * CLI adapter stays the default. `env` is injectable for tests; production passes process.env.
 */
export function getExecutor(kind: AgentKind, env: Env = process.env): Executor {
  if (kind === 'claude') {
    const sdkEnabled = guardDeferredEnv(env).RORO_SDK_EXECUTOR === '1';
    return sdkEnabled ? ClaudeSdkExecutor : ClaudeExecutor;
  }
  return CodexExecutor;
}
