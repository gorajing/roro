import { describe, it, expect } from 'vitest';
import { resolveExecutable } from './resolveBin';

function deps(present: string[]) {
  return {
    exists: (p: string) => present.includes(p),
    pathDirs: ['/usr/bin', '/opt/homebrew/bin'],
    extraDirs: ['/home/u/.local/bin'],
  };
}

describe('resolveExecutable', () => {
  it('honors an explicit env override unconditionally', () => {
    expect(resolveExecutable('codex', '/custom/codex', deps([]))).toBe('/custom/codex');
  });

  it('finds the binary on PATH', () => {
    expect(resolveExecutable('codex', undefined, deps(['/opt/homebrew/bin/codex']))).toBe('/opt/homebrew/bin/codex');
  });

  it('finds the binary in a common dir even when PATH lacks it (packaged Electron strips PATH)', () => {
    expect(resolveExecutable('claude', undefined, deps(['/home/u/.local/bin/claude']))).toBe('/home/u/.local/bin/claude');
  });

  it('prefers earlier dirs (PATH before the common-dir fallbacks)', () => {
    expect(resolveExecutable('codex', undefined, deps(['/usr/bin/codex', '/opt/homebrew/bin/codex']))).toBe('/usr/bin/codex');
  });

  it('falls back to the bare name when nowhere found (spawn ENOENTs loud)', () => {
    expect(resolveExecutable('codex', undefined, deps([]))).toBe('codex');
  });
});
