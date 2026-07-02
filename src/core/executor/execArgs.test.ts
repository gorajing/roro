import { describe, expect, it } from 'vitest';
import { codexExecArgs } from './codex';
import { claudeArgs } from './claude';

// The readOnly branch exists for the fact-proposal ask (point-don't-act: a post-run reflection must
// never carry write capability). These pins also guard the CODING path's args from silent drift —
// the flag-coupling landmines (--verbose, --include-partial-messages) are load-bearing.

describe('codexExecArgs', () => {
  it('default (coding) args are exactly the proven v0.139.0 invocation', () => {
    expect(codexExecArgs({ repo: '/r', prompt: 'do x' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', '/r', 'do x',
    ]);
  });

  it('readOnly swaps ONLY the sandbox to read-only', () => {
    const args = codexExecArgs({ repo: '/r', prompt: 'reflect', readOnly: true });
    expect(args).toContain('read-only');
    expect(args).not.toContain('workspace-write');
    expect(args.filter((a: string) => a !== 'read-only')).toEqual(
      codexExecArgs({ repo: '/r', prompt: 'reflect' }).filter((a: string) => a !== 'workspace-write'),
    );
  });
});

describe('claudeArgs', () => {
  it('default (coding) args are exactly the proven 2.1.x invocation incl. the load-bearing flags', () => {
    expect(claudeArgs({ prompt: 'do x' })).toEqual([
      '-p', 'do x', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Bash',
    ]);
  });

  it('readOnly uses plan mode with Read as the only allowed tool — no Write, no Edit, no Bash', () => {
    const args = claudeArgs({ prompt: 'reflect', readOnly: true });
    expect(args).toContain('plan');
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe('Read');
    expect(args.join(' ')).not.toMatch(/acceptEdits|Write|Edit|Bash/);
  });
});
