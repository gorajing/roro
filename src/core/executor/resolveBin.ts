// src/executor/resolveBin.ts — portable resolution of the codex/claude CLI binaries.
//
// Packaged Electron strips PATH (so /opt/homebrew/bin etc. vanish), which is why the old code
// hardcoded a single absolute path — but a hardcoded path breaks for every machine but one. Instead:
// honor an explicit env override, else probe PATH + the common install dirs by existence, else fall
// back to the bare name so spawn ENOENTs LOUD (surfaced as run.failed) rather than silently picking a
// path that exists for no one.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export interface ResolveDeps {
  exists(path: string): boolean;
  pathDirs: string[];
  extraDirs: string[];
}

export type ExecutableResolutionSource = 'env' | 'path' | 'common' | 'bare';

export interface ExecutableResolution {
  path: string;
  source: ExecutableResolutionSource;
  found: boolean;
}

export function resolveExecutableDetails(
  name: string,
  envOverride: string | undefined,
  deps: ResolveDeps,
): ExecutableResolution {
  if (envOverride) {
    return { path: envOverride, source: 'env', found: deps.exists(envOverride) };
  }

  for (const dir of deps.pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (deps.exists(candidate)) return { path: candidate, source: 'path', found: true };
  }

  for (const dir of deps.extraDirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (deps.exists(candidate)) return { path: candidate, source: 'common', found: true };
  }

  return { path: name, source: 'bare', found: false };
}

export function resolveExecutable(name: string, envOverride: string | undefined, deps: ResolveDeps): string {
  return resolveExecutableDetails(name, envOverride, deps).path;
}

export const COMMON_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), 'bin'),
];

/** Resolve a CLI binary: env override -> PATH -> common install dirs -> bare name. */
export function resolveBin(name: string, envOverride: string | undefined): string {
  return resolveExecutable(name, envOverride, {
    exists: existsSync,
    pathDirs: (process.env.PATH ?? '').split(delimiter).filter(Boolean),
    extraDirs: COMMON_BIN_DIRS,
  });
}

/** PATH for spawning a resolved executor CLI, including its runtime (for npm/bin env-node launchers). */
export function executorPathEnv(binPath: string, env: { PATH?: string } = process.env): string {
  const dirs: string[] = [];
  const add = (dir: string | undefined): void => {
    if (!dir || dirs.includes(dir)) return;
    dirs.push(dir);
  };
  if (binPath.includes('/') || binPath.includes('\\')) add(dirname(binPath));
  for (const dir of COMMON_BIN_DIRS) add(dir);
  for (const dir of (env.PATH ?? '').split(delimiter)) add(dir);
  return dirs.join(delimiter);
}
