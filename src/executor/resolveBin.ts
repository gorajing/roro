// src/executor/resolveBin.ts — portable resolution of the codex/claude CLI binaries.
//
// Packaged Electron strips PATH (so /opt/homebrew/bin etc. vanish), which is why the old code
// hardcoded a single absolute path — but a hardcoded path breaks for every machine but one. Instead:
// honor an explicit env override, else probe PATH + the common install dirs by existence, else fall
// back to the bare name so spawn ENOENTs LOUD (surfaced as run.failed) rather than silently picking a
// path that exists for no one.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolveDeps {
  exists(path: string): boolean;
  pathDirs: string[];
  extraDirs: string[];
}

export function resolveExecutable(name: string, envOverride: string | undefined, deps: ResolveDeps): string {
  if (envOverride) return envOverride; // explicit override wins — trust the operator
  for (const dir of [...deps.pathDirs, ...deps.extraDirs]) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (deps.exists(candidate)) return candidate;
  }
  return name; // last resort: spawn resolves via PATH and ENOENTs loud if it's truly absent
}

const COMMON_BIN_DIRS = [
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
    pathDirs: (process.env.PATH ?? '').split(':').filter(Boolean),
    extraDirs: COMMON_BIN_DIRS,
  });
}
