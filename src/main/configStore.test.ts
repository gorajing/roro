import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigCorruptError,
  hydrateWorkdirConfigFromStore,
  loadRoroConfig,
  parseConfigFile,
  saveRoroConfig,
} from './configStore';
import { setPersistedWorkdir, tryResolveWorkdir } from './workdir';

describe('parseConfigFile', () => {
  it('accepts a config with a chosen workdir', () => {
    expect(parseConfigFile(JSON.stringify({ workdir: '  /Users/jin/project  ' }))).toEqual({
      ok: true,
      config: { workdir: '/Users/jin/project' },
    });
  });

  it('accepts an empty object as no first-run choices yet', () => {
    expect(parseConfigFile('{}')).toEqual({ ok: true, config: {} });
  });

  it('rejects garbage and invalid workdir values', () => {
    expect(parseConfigFile('not json')).toEqual({ ok: false });
    expect(parseConfigFile('[]')).toEqual({ ok: false });
    expect(parseConfigFile(JSON.stringify({ workdir: '' }))).toEqual({ ok: false });
    expect(parseConfigFile(JSON.stringify({ workdir: 123 }))).toEqual({ ok: false });
  });
});

describe('configStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roro-config-'));
    setPersistedWorkdir(undefined);
  });

  afterEach(async () => {
    setPersistedWorkdir(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('loads an empty config when config.json is absent', async () => {
    await expect(loadRoroConfig(dir)).resolves.toEqual({});
  });

  it('loads a valid config from disk', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ workdir: '/repo' }), 'utf8');
    await expect(loadRoroConfig(dir)).resolves.toEqual({ workdir: '/repo' });
  });

  it('throws ConfigCorruptError when config.json is present but invalid', async () => {
    await writeFile(join(dir, 'config.json'), '{ corrupt', 'utf8');
    await expect(loadRoroConfig(dir)).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('writes config.json atomically without leaving a tmp file', async () => {
    await saveRoroConfig(dir, { workdir: '/chosen/repo' });

    const files = await readdir(dir);
    expect(files).toEqual(['config.json']);
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk).toEqual({ workdir: '/chosen/repo' });
  });

  it('hydrates the resolver from config when the env var is unset', async () => {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    await saveRoroConfig(dir, { workdir: repo });
    const env: NodeJS.ProcessEnv = {};

    const result = await hydrateWorkdirConfigFromStore(dir, env);

    expect(result).toEqual({ workdir: repo, source: 'config' });
    expect(env.RORO_WORKDIR).toBeUndefined();
    expect(tryResolveWorkdir(env, '/cwd')).toBe(repo);
  });

  it('does not clobber an explicit RORO_WORKDIR env var', async () => {
    await saveRoroConfig(dir, { workdir: '/persisted/repo' });
    const env: NodeJS.ProcessEnv = { RORO_WORKDIR: '/env/repo' };

    const result = await hydrateWorkdirConfigFromStore(dir, env);

    expect(result).toEqual({ workdir: '/env/repo', source: 'env' });
    expect(env.RORO_WORKDIR).toBe('/env/repo');
    expect(tryResolveWorkdir(env, '/cwd')).toBe('/env/repo');
  });

  it('honors an explicit RORO_WORKDIR even when config.json is corrupt', async () => {
    await writeFile(join(dir, 'config.json'), '{ corrupt', 'utf8');
    const env: NodeJS.ProcessEnv = { RORO_WORKDIR: '/env/repo' };

    const result = await hydrateWorkdirConfigFromStore(dir, env);

    expect(result).toEqual({ workdir: '/env/repo', source: 'env' });
    expect(tryResolveWorkdir(env, '/cwd')).toBe('/env/repo');
  });

  it('treats a blank RORO_WORKDIR env var as unset so packaged config can recover', async () => {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    await saveRoroConfig(dir, { workdir: repo });
    const env: NodeJS.ProcessEnv = { RORO_WORKDIR: '   ' };

    const result = await hydrateWorkdirConfigFromStore(dir, env);

    expect(result).toEqual({ workdir: repo, source: 'config' });
    expect(env.RORO_WORKDIR).toBe('   ');
    expect(tryResolveWorkdir(env, '/cwd')).toBe(repo);
  });

  it('treats a stale persisted workdir as unset so onboarding can recover', async () => {
    await saveRoroConfig(dir, { workdir: join(dir, 'deleted-repo') });
    const env: NodeJS.ProcessEnv = {};

    const result = await hydrateWorkdirConfigFromStore(dir, env);

    expect(result).toEqual({ source: 'unset' });
    expect(tryResolveWorkdir(env, '/cwd')).toBeUndefined();
  });
});
