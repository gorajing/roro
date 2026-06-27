import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getExecutorReadiness } from './executorReadiness';

describe('executor readiness', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roro-executor-ready-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function executable(name: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(path, 0o755);
    return path;
  }

  it('reports the default Codex executor ready when an executable is found on PATH', async () => {
    const codex = await executable('codex');

    await expect(getExecutorReadiness('codex', {
      env: { PATH: dir, HOME: dir },
      canExecute: async (path) => path === codex,
      commonDirs: [],
    })).resolves.toMatchObject({
      ready: true,
      agent: 'codex',
      command: 'codex',
      envVar: 'RORO_CODEX_BIN',
      path: codex,
      source: 'path',
    });
  });

  it('fails before dispatch when no executable is found', async () => {
    await expect(getExecutorReadiness('codex', {
      env: { PATH: dir, HOME: dir },
      canExecute: async () => false,
      commonDirs: [],
    })).resolves.toMatchObject({
      ready: false,
      path: 'codex',
      source: 'bare',
      message: expect.stringContaining('Codex CLI not found'),
    });
  });

  it('reports a broken explicit override separately from a missing PATH install', async () => {
    const missing = join(dir, 'missing-codex');

    await expect(getExecutorReadiness('codex', {
      env: { PATH: dir, HOME: dir, RORO_CODEX_BIN: missing },
      canExecute: async () => false,
      commonDirs: [],
    })).resolves.toMatchObject({
      ready: false,
      path: missing,
      source: 'env',
      message: expect.stringContaining('RORO_CODEX_BIN is not executable'),
    });
  });
});
