// src/executor/claudeSdk.ts — the Claude Agent-SDK executor (flag-gated dark, the CLI adapter stays
// default). Converts the destructive-Bash gate from post-hoc regex ABORT to PRE-EXECUTION
// default-deny via the SDK's PreToolUse hook + canUseTool, adjudicated by the pure claudeSdkGate.
//
// It SPAWNS the same engine the CLI adapter drives (pathToClaudeCodeExecutable = the user's installed
// CLI via resolveBin), but wraps it in a typed control channel. The message-stream mapping REUSES the
// CLI mapper verbatim (mapClaudeMessage/mapClaudeMessageBlocks/mapClaudeStreamEvent), so the canonical
// ActionEvent output is byte-identical — pinned by fixtures.test.ts against a live-captured stream.
//
// The SDK is ESM-only ("type":"module", no CJS export) and roro's main is CJS; it is loaded via
// dynamic `await import()` (Vite bundles it statically into the main chunk — vite.main.config.ts).
//
// PROBE-ESTABLISHED behavior (claudeSdk.probes.live.test.ts, SDK 0.3.198 ⇄ CLI 2.1.198):
//   - acceptEdits AUTO-APPROVES workspace file-mutation Bash BEFORE canUseTool → the PreToolUse hook
//     (which precedes EVERYTHING) is the load-bearing gate; canUseTool is the backstop.
//   - the abort throw is `instanceof AbortError` but its .name is 'Error' → discriminate by instanceof.
import {
  ActionEvent,
  ExecutorRunOptions,
  Executor,
  newRunId,
} from '../shared/events';
import {
  mapClaudeMessage,
  mapClaudeMessageBlocks,
  mapClaudeStreamEvent,
  newClaudeCorrelation,
} from './claude';
import { executorPathEnv, resolveBin } from './resolveBin';
import { createSdkGate, type DestructiveGate, type SdkGate } from './claudeSdkGate';
import type { CanUseTool, HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';

// Same portable resolution as the CLI adapter: RORO_CLAUDE_BIN -> PATH -> common dirs -> bare name.
// The SDK is pointed HERE, so roro runs the user's CLI + the user's auth, and ships zero extra MB
// (the SDK's 229MB bundled-binary optionalDependency is never resolved — dead code).
const CLAUDE_BIN = resolveBin('claude', process.env.RORO_CLAUDE_BIN);

/** The readOnly closed-world belt (the fact-proposal reflection must never carry write/exec). */
const READONLY_DISALLOWED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch'];

/** Bridge the pump's AbortSignal onto a fresh AbortController the SDK owns (its `abortController`
 *  option). Fires immediately if the signal is already aborted. */
export function bridgeAbort(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (!signal) return controller;
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller;
}

/** The PreToolUse 'Bash' hook — the HARD invariant. It precedes auto-approval (probe P1/P2b), so a
 *  deny here blocks a destructive Bash acceptEdits would otherwise run. Allow returns {} (no
 *  decision) so the normal flow proceeds; the ask lives inside gate.adjudicate. */
function bashPreToolUseHook(gate: SdkGate): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {};
    const toolInput = input.tool_input as Record<string, unknown> | undefined;
    const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
    const decision = await gate.adjudicate(input.tool_use_id, command);
    if (decision.behavior === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.message,
        },
      };
    }
    return {};
  };
}

/** canUseTool — the backstop for a Bash acceptEdits did NOT auto-approve (probe P2). Memoized with
 *  the hook by toolUseID → one adjudication, no double-ask. Non-Bash tools pass through (the coding
 *  run is deliberately NOT closed-world; only Bash is gated). */
function bashCanUseTool(gate: SdkGate): CanUseTool {
  return async (toolName, input, options) => {
    if (toolName !== 'Bash') return { behavior: 'allow' };
    const command = typeof (input as Record<string, unknown>).command === 'string'
      ? String((input as Record<string, unknown>).command)
      : '';
    const decision = await gate.adjudicate(options.toolUseID ?? '', command);
    if (decision.behavior === 'deny') {
      return { behavior: 'deny', message: decision.message, interrupt: false };
    }
    return { behavior: 'allow' };
  };
}

export interface SdkOptionDeps {
  controller: AbortController;
  /** The per-run adjudication delegate. null ⇒ a readOnly reflection (no gate, closed-world belt). */
  gate: SdkGate | null;
  /** resolveBin('claude', …) — injected so buildSdkOptions is pure/pinnable. */
  pathToClaudeCodeExecutable: string;
  /** The subprocess env. options.env REPLACES (never merges) — the caller MUST spread process.env. */
  env: Record<string, string | undefined>;
}

/**
 * PURE, pinned builder for the SDK query Options (sibling of the CLI adapter's claudeArgs). Every
 * value here is load-bearing and pinned by claudeSdk.buildOptions.test.ts:
 *   - Bash is DELIBERATELY off allowedTools (coding): it flows to the hook (ask) + canUseTool (backstop).
 *   - settingSources ['project']: the user's global/local hooks + allow-rules must NEVER widen the
 *     gate inside roro (probe P4). 'project' still loads the repo's CLAUDE.md.
 *   - systemPrompt preset 'claude_code': the SDK default is minimal — restore CLI parity.
 *   - persistSession false: no ~/.claude/projects JSONL for roro-driven runs.
 *   - includePartialMessages: token deltas (message.delta parity with the CLI --include-partial-messages).
 */
export function buildSdkOptions(
  opts: Pick<ExecutorRunOptions, 'repo' | 'readOnly'>,
  deps: SdkOptionDeps,
): Options {
  const base: Options = {
    cwd: opts.repo,
    abortController: deps.controller,
    pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable,
    env: deps.env,
    includePartialMessages: true,
    settingSources: ['project'],
    persistSession: false,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
  };
  if (opts.readOnly) {
    // Plan mode + Read-only allow + the disallowed belt: a reflection cannot write/exec. No hooks,
    // no canUseTool — headless auto-deny is the closed-world floor (probe P5).
    return {
      ...base,
      permissionMode: 'plan',
      allowedTools: ['Read'],
      disallowedTools: READONLY_DISALLOWED,
    };
  }
  // Coding run: Read/Edit/Write auto-approved, Bash gated by the hook + canUseTool.
  if (!deps.gate) {
    throw new Error('[claudeSdk] a coding SDK run requires a destructive gate — refusing to run ungated');
  }
  return {
    ...base,
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Edit', 'Write'],
    hooks: { PreToolUse: [{ matcher: 'Bash', timeout: 30, hooks: [bashPreToolUseHook(deps.gate)] }] },
    canUseTool: bashCanUseTool(deps.gate),
  };
}

/**
 * PURE mapper: a full SDKMessage array -> the canonical ActionEvent sequence, mirroring the CLI
 * adapter's stream loop EXACTLY (init -> run.started + synthesized turn.started; assistant/user
 * blocks fanned out; stream_event -> message.delta; result -> terminal). SDKUserMessageReplay
 * (isReplay) is skipped (resume double-emit). Gate-agnostic — this is the fixtures-pinned parity
 * proof; the live adapter overlays the Bash gate on top of this same mapping.
 */
export function sdkMessagesToEvents(messages: unknown[], runId: string): ActionEvent[] {
  const out: ActionEvent[] = [];
  const corr = newClaudeCorrelation();
  let emittedStart = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;

    const delta = mapClaudeStreamEvent(msg, runId);
    if (delta) {
      out.push(delta);
      continue;
    }

    if (!emittedStart && m.type === 'system' && m.subtype === 'init') {
      const started = mapClaudeMessage(msg, runId, corr);
      if (started) {
        emittedStart = true;
        out.push(started);
        out.push({ kind: 'turn.started', runId, ts: started.ts });
      }
      continue;
    }

    if (m.type === 'assistant' || m.type === 'user') {
      if (m.type === 'user' && m.isReplay === true) continue; // resume replay — skip
      for (const ev of mapClaudeMessageBlocks(msg, runId, corr)) out.push(ev);
      continue;
    }

    const mapped = mapClaudeMessage(msg, runId, corr);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * The live SDK executor generator. Drains query()'s typed message stream, reusing the CLI mapper,
 * and overlays the destructive gate on Bash:
 *   - a Bash `command`/started is emitted ONLY AFTER gate.adjudicate clears it (the ask precedes the
 *     UI beat); a denied command emits a legible `status` beat and NO command event.
 *   - a Bash `command` completion for a denied id is suppressed; one whose id never traversed the
 *     gate FAILS the run loud (gate-bypass tripwire — keyed by toolUseId, never command string).
 * AbortError (instanceof — NOT err.name; probe P3) => yield nothing, return (the pump's stopped
 * path). Any other throw propagates to the pump's stream-threw arm.
 */
export async function* runClaudeSdk(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> {
  const runId = newRunId();
  if (opts.signal?.aborted) return; // pre-aborted: yield nothing, the pump ends as stopped

  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const { query, AbortError } = sdk;

  const controller = bridgeAbort(opts.signal);
  // ExecutorRunOptions.gate is typed `unknown` in shared/events.ts (so shared stays free of the
  // executor's DestructiveGate shape); startPump only ever injects a real DestructiveGate.
  const gate = opts.gate ? createSdkGate(runId, opts.gate as DestructiveGate) : null;
  const options = buildSdkOptions(opts, {
    controller,
    gate,
    pathToClaudeCodeExecutable: CLAUDE_BIN,
    env: { ...process.env, PATH: executorPathEnv(CLAUDE_BIN, process.env) }, // env REPLACES — spread is mandatory
  });

  const corr = newClaudeCorrelation();
  let emittedStart = false;
  const deniedIds = new Set<string>();

  try {
    for await (const msg of query({ prompt: opts.prompt, options })) {
      if (opts.signal?.aborted) break;
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;

      const delta = mapClaudeStreamEvent(msg, runId);
      if (delta) {
        yield delta;
        continue;
      }

      if (!emittedStart && m.type === 'system' && m.subtype === 'init') {
        const started = mapClaudeMessage(msg, runId, corr);
        if (started) {
          emittedStart = true;
          yield started;
          yield { kind: 'turn.started', runId, ts: Date.now() };
        }
        continue;
      }

      if (m.type === 'assistant') {
        for (const ev of mapClaudeMessageBlocks(msg, runId, corr)) {
          // Defer a Bash command/started behind the gate decision (the ask precedes the UI beat).
          if (gate && ev.kind === 'command' && ev.status === 'started') {
            const decision = await gate.adjudicate(ev.itemId, ev.command);
            if (decision.behavior === 'deny') {
              deniedIds.add(ev.itemId);
              yield { kind: 'status', runId, text: `Skipped a destructive command — ${denyReason(decision.message)}`, ts: Date.now() };
              continue;
            }
          }
          yield ev;
        }
        continue;
      }

      if (m.type === 'user') {
        if (m.isReplay === true) continue; // resume replay — skip (double-emit)
        for (const ev of mapClaudeMessageBlocks(msg, runId, corr)) {
          if (gate && ev.kind === 'command' && deniedIds.has(ev.itemId)) {
            // GATE-BYPASS TRIPWIRE: a denied Bash must come back blocked (is_error:true → status
            // 'failed'). If its tool_result is is_error:false ('completed'), the command EXECUTED
            // despite the deny — the gate was bypassed. Fail the run loud (never silently swallow a
            // destructive command that ran). Keyed by toolUseId, never by command-string equality.
            if (ev.status === 'completed') {
              yield {
                kind: 'run.failed',
                runId,
                ok: false,
                error: `gate bypass: a destructive Bash command (${ev.itemId}) was denied but executed anyway`,
                ts: Date.now(),
              };
              return;
            }
            continue; // status 'failed' = the deny blocked it as expected — suppress the completion
          }
          yield ev;
        }
        continue;
      }

      const mapped = mapClaudeMessage(msg, runId, corr);
      if (mapped) yield mapped;
    }
  } catch (err) {
    if (err instanceof AbortError) return; // Stop: yield nothing, the pump's stopped path
    throw err; // any other throw -> the pump's stream-threw run.failed arm
  }
}

/** Strip the fixed prefix/suffix of gateDenyMessage down to the bare reason for the status beat. */
function denyReason(message: string): string {
  const match = message.match(/\(([^)]+)\)/);
  return match ? match[1] : 'it was not approved';
}

export const ClaudeSdkExecutor: Executor = {
  run(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> {
    return runClaudeSdk(opts);
  },
};

export type { DestructiveGate };
