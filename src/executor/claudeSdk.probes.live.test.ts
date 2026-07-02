// src/executor/claudeSdk.probes.live.test.ts — W6 C1: LIVE pairing probes, SDK ⇄ the founder's
// REAL installed claude CLI (docs/plans/sdk-executor.md, "Probes FIRST").
//
// The SDK (@anthropic-ai/claude-agent-sdk, exact pin 0.3.198) ships its own bundled CLI binary
// (claudeCodeVersion 2.1.198) but roro points it at the USER'S installed CLI via
// pathToClaudeCodeExecutable = resolveBin('claude', RORO_CLAUDE_BIN) — zero extra megabytes, the
// user's own auth. Version skew between sdk.mjs's control protocol and the installed CLI is THE
// risk, so every hard invariant the W6 permission architecture rests on is probed HERE, against
// the real pairing, before any adapter code:
//   P1  a PreToolUse hook observes a CLI-auto-approved Bash (`echo`) — hooks precede auto-approval
//   P2  canUseTool receives a non-auto-approved Bash and deny PREVENTS execution (pre-execution!)
//   P2b under the adapter's CODING shape (acceptEdits), a PreToolUse hook DENY blocks a destructive
//       Bash that acceptEdits would otherwise auto-approve — THE hard-gate invariant
//   P3  abort() → the for-await throws AbortError, NO result message is yielded first
//   P4  settingSources: ['project'] keeps the user's global/local permission config OUT
//   P5  plan-mode + allowedTools ['Read'] (the readOnly shape) cannot write a file
// IF P1 OR P2/P2b FAILS: do not proceed — flip pathToClaudeCodeExecutable to the SDK's bundled
// platform binary and record the deviation (the spec's decision point).
//
// PROBE-ESTABLISHED FACTS the adapter is built on (all empirical, CLI 2.1.198 ⇄ SDK 0.3.198):
//   - acceptEdits AUTO-APPROVES workspace file-mutation Bash (`rm -rf ./dir` included!) BEFORE
//     canUseTool — verified identical on the SDK's bundled binary, so it is a semantic property of
//     CLI 2.1.198, not version skew. The PreToolUse hook is therefore the LOAD-BEARING gate for
//     coding runs; canUseTool is the backstop for whatever is not auto-approved (P2, 'default').
//   - A hook deny prevents execution, feeds its reason to the model as the tool error, records the
//     denial in result.permission_denials, and the run CONTINUES to its own verdict (deny-continues).
//   - The abort throw IS `instanceof AbortError` but its `.name` is 'Error' (minified class) — the
//     adapter must discriminate by instanceof, never by err.name.
//   - Bare allowedTools entries (Read/Edit/Write) auto-approve those tools wholesale before
//     canUseTool (the SDK warns: CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). W6 gates Bash only, so this is
//     accepted and documented, not fought.
//
// OPT-IN (live API traffic, billed to the founder's claude login; no API key involved):
//   RORO_SDK_PROBES=1 npx vitest run src/executor/claudeSdk.probes.live.test.ts
// Skipped by default so normal `npm test` / CI never spawns the CLI or spends tokens.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { executorPathEnv, resolveBin } from './resolveBin';
import type { Options, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const LIVE = process.env.RORO_SDK_PROBES === '1';
const CLAUDE_BIN = resolveBin('claude', process.env.RORO_CLAUDE_BIN);
const PROBE_TIMEOUT_MS = 240_000;

/** ESM-only package in a CJS-compiled repo — always load it dynamically (same as the adapter will). */
async function sdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  return import('@anthropic-ai/claude-agent-sdk');
}

function tempRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** The probe baseline mirrors the adapter contract (spec "Adapter" section): the user's CLI, the
 *  user's default credential chain (spread env, NEVER replace), project-only settings, ephemeral
 *  session, bounded turns. Individual probes override the permission surface they are probing. */
function baseOptions(repo: string): Options {
  return {
    cwd: repo,
    pathToClaudeCodeExecutable: CLAUDE_BIN,
    env: { ...process.env, PATH: executorPathEnv(CLAUDE_BIN, process.env) },
    settingSources: ['project'],
    persistSession: false,
    maxTurns: 4,
  };
}

interface DrainResult {
  messages: SDKMessage[];
  init: Extract<SDKMessage, { type: 'system'; subtype: 'init' }> | null;
  result: Extract<SDKMessage, { type: 'result' }> | null;
  /** tool_use_id -> Bash command string, from assistant tool_use blocks. */
  bashCommands: Map<string, string>;
  /** tool_use_ids whose tool_result came back with is_error !== true (the command actually ran). */
  succeededToolIds: Set<string>;
}

/** Drain a query to its end, indexing the messages the probes assert on. */
async function drain(q: AsyncIterable<SDKMessage>): Promise<DrainResult> {
  const out: DrainResult = {
    messages: [],
    init: null,
    result: null,
    bashCommands: new Map(),
    succeededToolIds: new Set(),
  };
  for await (const m of q) {
    out.messages.push(m);
    if (m.type === 'system' && m.subtype === 'init') out.init = m;
    if (m.type === 'result') out.result = m;
    if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'tool_use' && b.name === 'Bash') {
          const input = b.input as Record<string, unknown>;
          out.bashCommands.set(b.id, typeof input.command === 'string' ? input.command : '');
        }
      }
    }
    if (m.type === 'user') {
      const content = m.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (typeof b === 'object' && b !== null && b.type === 'tool_result' && b.is_error !== true) {
            out.succeededToolIds.add(b.tool_use_id);
          }
        }
      }
    }
  }
  return out;
}

/** Did a Bash command matching `needle` actually execute (tool_use paired with a non-error tool_result)? */
function bashExecuted(r: DrainResult, needle: string): boolean {
  for (const [id, command] of r.bashCommands) {
    if (command.includes(needle) && r.succeededToolIds.has(id)) return true;
  }
  return false;
}

describe.runIf(LIVE)('LIVE Agent-SDK ⇄ installed-CLI pairing probes (opt-in: RORO_SDK_PROBES=1)', () => {
  it(
    'P1: a PreToolUse hook observes an auto-approved Bash (echo) that never reached canUseTool',
    async () => {
      const { query } = await sdk();
      const repo = tempRepo('roro-sdk-p1-');
      const hookSaw: Array<{ toolName: string; command: string }> = [];
      const canUseToolSaw: string[] = [];
      try {
        const r = await drain(
          query({
            prompt: 'Run exactly this one bash command and nothing else: echo roro-probe-p1',
            options: {
              ...baseOptions(repo),
              permissionMode: 'acceptEdits',
              allowedTools: ['Read', 'Edit', 'Write'], // Bash DELIBERATELY off — the adapter shape
              hooks: {
                PreToolUse: [
                  {
                    matcher: 'Bash',
                    timeout: 30,
                    hooks: [
                      async (input) => {
                        if (input.hook_event_name === 'PreToolUse') {
                          const toolInput = input.tool_input as Record<string, unknown>;
                          hookSaw.push({
                            toolName: input.tool_name,
                            command: typeof toolInput?.command === 'string' ? toolInput.command : '',
                          });
                        }
                        return {}; // observe only — no decision
                      },
                    ],
                  },
                ],
              },
              // Deny-everything backstop: if the CLI routed the echo here, it would NOT execute —
              // so "echo executed AND canUseTool never called" is only satisfiable by auto-approval
              // running AFTER the hook observed it. That conjunction is the P1 invariant.
              canUseTool: async (toolName): Promise<PermissionResult> => {
                canUseToolSaw.push(toolName);
                return { behavior: 'deny', message: 'P1 probe denies everything', interrupt: false };
              },
            },
          }),
        );
        console.log('[P1] init cli version:', r.init?.claude_code_version, 'hookSaw:', hookSaw, 'canUseToolSaw:', canUseToolSaw);
        expect(r.init).not.toBeNull();
        // THE hard invariant: the hook fired for the Bash echo (hooks precede auto-approval).
        expect(hookSaw.some((h) => h.toolName === 'Bash' && h.command.includes('echo roro-probe-p1'))).toBe(true);
        // The auto-approve premise: the echo executed without ever consulting canUseTool.
        expect(bashExecuted(r, 'echo roro-probe-p1')).toBe(true);
        expect(canUseToolSaw).toEqual([]);
        expect(r.result?.subtype).toBe('success');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "P2: canUseTool (permissionMode 'default') receives a destructive Bash and deny PREVENTS execution",
    async () => {
      const { query } = await sdk();
      const repo = tempRepo('roro-sdk-p2-');
      const target = join(repo, 'target-dir');
      mkdirSync(target);
      const canUseToolSaw: Array<{ toolName: string; command: string }> = [];
      try {
        const r = await drain(
          query({
            prompt:
              'Run exactly this one bash command and nothing else: rm -rf ./target-dir\n' +
              'If the command is denied, do not retry it in any form; just say DENIED.',
            options: {
              ...baseOptions(repo),
              // 'default', NOT acceptEdits: on CLI 2.1.198 acceptEdits auto-approves workspace
              // file-mutation Bash before the callback (see P2b, which probes that shape). This
              // probe pins the BACKSTOP: when a Bash is not auto-approved, canUseTool is the
              // pre-execution decision point and deny blocks the child from ever running it.
              permissionMode: 'default',
              allowedTools: ['Read', 'Edit', 'Write'],
              canUseTool: async (toolName, input): Promise<PermissionResult> => {
                const command = typeof (input as Record<string, unknown>).command === 'string'
                  ? String((input as Record<string, unknown>).command)
                  : '';
                canUseToolSaw.push({ toolName, command });
                return { behavior: 'deny', message: 'roro: destructive command denied by probe', interrupt: false };
              },
            },
          }),
        );
        console.log('[P2] canUseToolSaw:', canUseToolSaw, 'permission_denials:', r.result && 'permission_denials' in r.result ? r.result.permission_denials : null);
        // The backstop invariant: the non-auto-approved destructive Bash reached canUseTool…
        expect(canUseToolSaw.some((c) => c.toolName === 'Bash' && c.command.includes('rm -rf'))).toBe(true);
        // …and the deny happened BEFORE execution: filesystem truth, the dir still exists.
        expect(existsSync(target)).toBe(true);
        expect(bashExecuted(r, 'rm -rf')).toBe(false);
        // deny with interrupt:false lets the run CONTINUE to its own verdict (the spec's deny-continues).
        expect(r.result).not.toBeNull();
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    'P2b: under acceptEdits (the coding shape) a PreToolUse hook DENY blocks the auto-approved destructive Bash',
    async () => {
      const { query } = await sdk();
      const repo = tempRepo('roro-sdk-p2b-');
      const target = join(repo, 'target-dir');
      mkdirSync(target);
      const hookSaw: Array<{ toolName: string; command: string }> = [];
      const canUseToolSaw: string[] = [];
      try {
        const r = await drain(
          query({
            prompt:
              'Run exactly this one bash command and nothing else: rm -rf ./target-dir\n' +
              'If the command is denied, do not retry it in any form; just say DENIED.',
            options: {
              ...baseOptions(repo),
              permissionMode: 'acceptEdits',
              allowedTools: ['Read', 'Edit', 'Write'],
              hooks: {
                PreToolUse: [
                  {
                    matcher: 'Bash',
                    timeout: 30,
                    hooks: [
                      async (input) => {
                        if (input.hook_event_name === 'PreToolUse') {
                          const toolInput = input.tool_input as Record<string, unknown>;
                          hookSaw.push({
                            toolName: input.tool_name,
                            command: typeof toolInput?.command === 'string' ? toolInput.command : '',
                          });
                        }
                        return {
                          hookSpecificOutput: {
                            hookEventName: 'PreToolUse' as const,
                            permissionDecision: 'deny' as const,
                            permissionDecisionReason:
                              'roro: destructive command denied by probe. Do not retry destructive variants.',
                          },
                        };
                      },
                    ],
                  },
                ],
              },
              canUseTool: async (toolName): Promise<PermissionResult> => {
                canUseToolSaw.push(toolName);
                return { behavior: 'deny', message: 'roro probe backstop deny', interrupt: false };
              },
            },
          }),
        );
        const denials = r.result && 'permission_denials' in r.result ? r.result.permission_denials : null;
        console.log('[P2b] hookSaw:', hookSaw, '| canUseToolSaw:', canUseToolSaw, '| permission_denials:', denials);
        // THE hard-gate invariant for coding runs: the hook saw the destructive Bash that
        // acceptEdits would have auto-approved (P2 vs this probe), and its deny BLOCKED execution.
        expect(hookSaw.some((h) => h.toolName === 'Bash' && h.command.includes('rm -rf'))).toBe(true);
        expect(existsSync(target)).toBe(true);
        expect(bashExecuted(r, 'rm -rf')).toBe(false);
        // Deny-continues: the run still reaches its own verdict, with the denial on the record.
        expect(r.result).not.toBeNull();
        expect(denials?.some((d: { tool_name: string }) => d.tool_name === 'Bash')).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    'P3: abort() makes the for-await THROW AbortError with NO result message yielded first',
    async () => {
      const { query, AbortError } = await sdk();
      const repo = tempRepo('roro-sdk-p3-');
      const ac = new AbortController();
      let sawResult = false;
      let threw: unknown = null;
      let abortedAt = 0;
      let threwAt = 0;
      try {
        const q = query({
          prompt: 'Write a long, detailed 2000-word essay about event loops. Do not use any tools.',
          options: { ...baseOptions(repo), permissionMode: 'acceptEdits', abortController: ac },
        });
        try {
          for await (const m of q) {
            if (m.type === 'result') sawResult = true;
            if (m.type === 'system' && m.subtype === 'init') {
              abortedAt = Date.now();
              ac.abort(); // abort as soon as the child proved alive
            }
          }
        } catch (err) {
          threw = err;
          threwAt = Date.now();
        }
        console.log('[P3] threw:', (threw as Error | null)?.message, '| abort→throw ms:', threwAt - abortedAt);
        // PROBED: the throw IS `instanceof AbortError` but err.name is 'Error' (minified class
        // never sets .name) — the adapter must discriminate by instanceof, NOT err.name.
        expect(threw).toBeInstanceOf(AbortError);
        expect(sawResult).toBe(false);
        // The child must die promptly — the pump's Stop watchdog (1.5s) only ends the UI; the SLOT
        // frees when the stream truly ends. 10s is the generous ceiling for SIGTERM teardown.
        expect(threwAt - abortedAt).toBeLessThan(10_000);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "P4: settingSources ['project'] keeps the user's global permission config OUT of the run",
    async () => {
      const { query } = await sdk();
      const repo = tempRepo('roro-sdk-p4-');
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const canUseToolSaw: Array<{ toolName: string; command: string }> = [];
      // Contrast markers in the FOUNDER's real config (informational — logged, not required):
      // user settings carry permissions.defaultMode='auto'; local settings allow 'Bash(git commit *)'.
      // Under default settingSources BOTH would swallow this probe (auto-mode classifier / allow rule
      // skips canUseTool). Under ['project'] NEITHER may load.
      let userHasAutoMode = false;
      let localAllowsGitCommit = false;
      try {
        const userSettings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
        userHasAutoMode = userSettings?.permissions?.defaultMode === 'auto';
      } catch {
        // no user settings — the isolation assertions below still hold
      }
      try {
        const localSettings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.local.json'), 'utf8'));
        localAllowsGitCommit = Array.isArray(localSettings?.permissions?.allow)
          && localSettings.permissions.allow.some((rule: unknown) => typeof rule === 'string' && rule.startsWith('Bash(git commit'));
      } catch {
        // no local settings — same
      }
      try {
        const r = await drain(
          query({
            prompt:
              'Run exactly this one bash command and nothing else: git commit --allow-empty -m roro-probe-p4\n' +
              'If the command is denied, do not retry it; just say DENIED.',
            options: {
              ...baseOptions(repo),
              // NO permissionMode passed — so a leaked user defaultMode ('auto') would show in init.
              canUseTool: async (toolName, input): Promise<PermissionResult> => {
                const command = typeof (input as Record<string, unknown>).command === 'string'
                  ? String((input as Record<string, unknown>).command)
                  : '';
                canUseToolSaw.push({ toolName, command });
                return { behavior: 'deny', message: 'roro: probe denies everything', interrupt: false };
              },
            },
          }),
        );
        console.log(
          '[P4] init.permissionMode:', r.init?.permissionMode,
          '| user defaultMode=auto present:', userHasAutoMode,
          '| local Bash(git commit *) allow present:', localAllowsGitCommit,
          '| canUseToolSaw:', canUseToolSaw,
        );
        // The user's defaultMode must NOT leak in: baseline 'default', not 'auto'.
        expect(r.init?.permissionMode).toBe('default');
        // The user's Bash allow rules must NOT leak in: git commit reaches canUseTool (and is denied).
        expect(canUseToolSaw.some((c) => c.toolName === 'Bash' && c.command.includes('git commit'))).toBe(true);
        expect(bashExecuted(r, 'git commit')).toBe(false);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "P5: plan mode + allowedTools ['Read'] + disallowedTools belt (the readOnly shape) cannot write",
    async () => {
      const { query } = await sdk();
      const repo = tempRepo('roro-sdk-p5-');
      const forbidden = join(repo, 'p5-should-not-exist.txt');
      try {
        const r = await drain(
          query({
            prompt:
              'Create a file named p5-should-not-exist.txt containing the single word roro in the ' +
              'current directory. If you cannot, reply with exactly: CANNOT',
            options: {
              ...baseOptions(repo),
              permissionMode: 'plan',
              allowedTools: ['Read'],
              // The readOnly belt from the spec: closed world, no hooks, no gate, no canUseTool —
              // headless auto-deny is the floor for anything that still asks.
              disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch'],
            },
          }),
        );
        console.log('[P5] result subtype:', r.result?.subtype, '| file exists:', existsSync(forbidden));
        expect(r.init).not.toBeNull();
        expect(r.result).not.toBeNull(); // the run ends with a verdict either way…
        expect(existsSync(forbidden)).toBe(false); // …but the write NEVER lands
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS,
  );
});
