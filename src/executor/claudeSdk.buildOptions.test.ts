import { describe, expect, it, vi } from 'vitest';
import { buildSdkOptions, bridgeAbort, type SdkOptionDeps } from './claudeSdk';
import { createSdkGate, type DestructiveGate } from './claudeSdkGate';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

// buildSdkOptions is the SDK sibling of claudeArgs — every value is load-bearing (the flag-coupling
// landmines of the CLI path become option pins here). These lock the coding vs readOnly shapes and
// the two gate seams so a silent drift fails CI, exactly like execArgs.test.ts.

function fakeGate(overrides: Partial<DestructiveGate> = {}) {
  const gate: DestructiveGate = {
    classify: (command) => (command.includes('rm -rf') ? { destructive: true, reason: 'rm -r' } : { destructive: false }),
    ask: vi.fn(async () => false),
    onCleared: vi.fn(),
    ...overrides,
  };
  return createSdkGate('run_opts', gate);
}

function deps(overrides: Partial<SdkOptionDeps> = {}): SdkOptionDeps {
  return {
    controller: new AbortController(),
    gate: fakeGate(),
    pathToClaudeCodeExecutable: '/usr/local/bin/claude',
    env: { PATH: '/usr/local/bin', HOME: '/home/x' },
    ...overrides,
  };
}

describe('buildSdkOptions — coding run pins', () => {
  const controller = new AbortController();
  const options = buildSdkOptions({ repo: '/repo' }, deps({ controller }));

  it('pins cwd, the injected binary, the spread env, and the bridged abort controller', () => {
    expect(options.cwd).toBe('/repo');
    expect(options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
    expect(options.env).toEqual({ PATH: '/usr/local/bin', HOME: '/home/x' });
    expect(options.abortController).toBe(controller);
  });

  it('pins the coding permission surface: acceptEdits, Read/Edit/Write allowed, Bash DELIBERATELY off', () => {
    expect(options.permissionMode).toBe('acceptEdits');
    expect(options.allowedTools).toEqual(['Read', 'Edit', 'Write']);
    expect(options.allowedTools).not.toContain('Bash');
    expect(options.disallowedTools).toBeUndefined(); // coding is NOT closed-world
  });

  it('pins the isolation + parity options: project settings, ephemeral session, partials, claude_code preset', () => {
    expect(options.settingSources).toEqual(['project']);
    expect(options.persistSession).toBe(false);
    expect(options.includePartialMessages).toBe(true);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });

  it('wires BOTH gate seams: a PreToolUse hook matching Bash (30s timeout) and canUseTool', () => {
    const preToolUse = options.hooks?.PreToolUse;
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse?.[0].matcher).toBe('Bash');
    expect(preToolUse?.[0].timeout).toBe(30);
    expect(preToolUse?.[0].hooks).toHaveLength(1);
    expect(typeof options.canUseTool).toBe('function');
  });

  it('the PreToolUse hook DENIES a destructive Bash and returns {} (proceed) for a safe one', async () => {
    const gate = fakeGate({ ask: vi.fn(async () => false) }); // deny
    const opts = buildSdkOptions({ repo: '/repo' }, deps({ gate }));
    const hook = opts.hooks!.PreToolUse![0].hooks[0];
    const denied = await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'tu_1' } as never,
      'tu_1',
      { signal: new AbortController().signal },
    );
    expect(denied).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });

    const safe = await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_use_id: 'tu_2' } as never,
      'tu_2',
      { signal: new AbortController().signal },
    );
    expect(safe).toEqual({}); // non-destructive → no decision, normal flow proceeds
  });

  it('canUseTool denies a destructive Bash with interrupt:false and allows non-Bash tools', async () => {
    const gate = fakeGate({ ask: vi.fn(async () => false) });
    const opts = buildSdkOptions({ repo: '/repo' }, deps({ gate }));
    const canUseTool = opts.canUseTool!;
    const denied = (await canUseTool('Bash', { command: 'rm -rf build' }, { signal: new AbortController().signal, toolUseID: 'tu_x' } as never)) as PermissionResult;
    expect(denied).toMatchObject({ behavior: 'deny', interrupt: false });
    const allowed = await canUseTool('Read', { file_path: '/x' }, { signal: new AbortController().signal, toolUseID: 'tu_y' } as never);
    expect(allowed).toEqual({ behavior: 'allow' });
  });

  it('the hook and canUseTool for the SAME toolUseId ask AT MOST once (memoized across seams)', async () => {
    const ask = vi.fn(async () => true);
    const gate = fakeGate({ ask });
    const opts = buildSdkOptions({ repo: '/repo' }, deps({ gate }));
    const hook = opts.hooks!.PreToolUse![0].hooks[0];
    const canUseTool = opts.canUseTool!;
    await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'tu_same' } as never,
      'tu_same',
      { signal: new AbortController().signal },
    );
    await canUseTool('Bash', { command: 'rm -rf build' }, { signal: new AbortController().signal, toolUseID: 'tu_same' } as never);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('THROWS on a coding run with no gate binding (fail loud — never run ungated)', () => {
    expect(() => buildSdkOptions({ repo: '/repo' }, deps({ gate: null }))).toThrow(/requires a destructive gate/i);
  });
});

describe('buildSdkOptions — readOnly reflection pins', () => {
  const options = buildSdkOptions({ repo: '/repo', readOnly: true }, deps({ gate: null }));

  it('pins plan mode + Read-only allow + the disallowed belt, and NO gate seams', () => {
    expect(options.permissionMode).toBe('plan');
    expect(options.allowedTools).toEqual(['Read']);
    expect(options.disallowedTools).toEqual(['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch']);
    expect(options.hooks).toBeUndefined();
    expect(options.canUseTool).toBeUndefined();
  });

  it('keeps the shared isolation + parity options', () => {
    expect(options.settingSources).toEqual(['project']);
    expect(options.persistSession).toBe(false);
    expect(options.includePartialMessages).toBe(true);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });

  it('a readOnly run does NOT require a gate (null is fine)', () => {
    expect(() => buildSdkOptions({ repo: '/repo', readOnly: true }, deps({ gate: null }))).not.toThrow();
  });
});

describe('bridgeAbort', () => {
  it('returns a fresh controller and forwards a later abort', () => {
    const source = new AbortController();
    const bridged = bridgeAbort(source.signal);
    expect(bridged).toBeInstanceOf(AbortController);
    expect(bridged.signal.aborted).toBe(false);
    source.abort();
    expect(bridged.signal.aborted).toBe(true);
  });

  it('fires immediately when the source signal is already aborted', () => {
    const source = new AbortController();
    source.abort();
    expect(bridgeAbort(source.signal).signal.aborted).toBe(true);
  });

  it('returns an un-aborted controller when there is no source signal', () => {
    expect(bridgeAbort(undefined).signal.aborted).toBe(false);
  });
});
