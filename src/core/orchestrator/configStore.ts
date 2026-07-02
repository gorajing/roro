// src/main/configStore.ts — persisted first-run choices owned by Electron MAIN.
//
// Packaged apps do not read the developer's .env, so user choices that must survive relaunch
// live under app.getPath('userData')/config.json. Environment variables still win when set:
// they are the explicit dev/operator override.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WorkdirConfigMsg } from '../../shared/ipc';
import { setPersistedWorkdir } from './workdir';

export interface RoroConfig {
  workdir?: string;
}

export type WorkdirHydrationResult = WorkdirConfigMsg;

/** Thrown when config.json exists but is unreadable/garbled — we refuse to silently ignore it. */
export class ConfigCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigCorruptError';
  }
}

export function parseConfigFile(contents: string): { ok: true; config: RoroConfig } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };

  const rawWorkdir = (parsed as Record<string, unknown>).workdir;
  if (rawWorkdir === undefined) return { ok: true, config: {} };
  if (typeof rawWorkdir !== 'string') return { ok: false };

  const workdir = rawWorkdir.trim();
  return workdir ? { ok: true, config: { workdir } } : { ok: false };
}

export async function loadRoroConfig(dir: string): Promise<RoroConfig> {
  const path = join(dir, 'config.json');
  let contents: string | null = null;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (contents === null) return {};

  const parsed = parseConfigFile(contents);
  if (parsed.ok) return parsed.config;
  throw new ConfigCorruptError(`config.json at ${path} is present but unreadable`);
}

export async function saveRoroConfig(dir: string, config: RoroConfig): Promise<void> {
  const workdir = config.workdir?.trim();
  const normalized: RoroConfig = workdir ? { workdir } : {};
  await atomicWriteJson(join(dir, 'config.json'), normalized);
}

export async function hydrateWorkdirConfigFromStore(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<WorkdirHydrationResult> {
  const envWorkdir = env.RORO_WORKDIR?.trim();
  if (envWorkdir) {
    setPersistedWorkdir(undefined);
    return { workdir: envWorkdir, source: 'env' };
  }

  const config = await loadRoroConfig(dir);
  const persisted = config.workdir && await isExistingDirectory(config.workdir) ? config.workdir : undefined;
  setPersistedWorkdir(persisted);

  if (!persisted) return { source: 'unset' };

  return { workdir: persisted, source: 'config' };
}

export async function persistWorkdirChoice(
  dir: string,
  workdir: string,
  env: NodeJS.ProcessEnv,
): Promise<WorkdirHydrationResult> {
  const chosen = workdir.trim();
  if (!chosen) throw new Error('config:chooseWorkdir received an empty path');
  await saveRoroConfig(dir, { workdir: chosen });
  setPersistedWorkdir(chosen);

  const envWorkdir = env.RORO_WORKDIR?.trim();
  if (envWorkdir) return { workdir: envWorkdir, source: 'env' };
  return { workdir: chosen, source: 'config' };
}

export async function hydrateWorkdirConfig(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<WorkdirHydrationResult> {
  const result = await hydrateWorkdirConfigFromStore(dir, env);
  if (result.source === 'config') {
    console.log('[config] loaded persisted workdir from userData/config.json');
  }
  return result;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path); // rename is atomic on the same filesystem
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw err;
  }
}
