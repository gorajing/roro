import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: h.getPath },
  BrowserWindow: { fromWebContents: h.fromWebContents },
  dialog: { showOpenDialog: h.showOpenDialog },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown): void => { h.handlers.set(channel, fn); } },
  shell: { openExternal: h.openExternal },
}));

vi.mock('./mic', () => ({
  getMicStatus: () => 'unknown',
  ensureMicAccess: async () => 'unknown',
}));
vi.mock('./orchestrator', () => ({
  runTurn: vi.fn(),
  runTask: vi.fn(),
  cancelTask: vi.fn(),
  resolveDestructiveConfirm: vi.fn(),
}));
vi.mock('./siblings', () => ({
  loadBrain: vi.fn(),
  loadMemory: vi.fn(),
  loadVision: vi.fn(),
}));
vi.mock('./identity', () => ({
  getOwnerId: () => 'owner-test',
}));
vi.mock('../brain/ollama', () => ({
  pullModel: vi.fn(),
}));

import { CH } from '../shared/ipc';
import { registerIpcHandlers } from './ipc';
import { setPersistedWorkdir, tryResolveWorkdir } from './workdir';

function handler<T extends (...args: never[]) => unknown>(channel: string): T {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`missing handler for ${channel}`);
  return fn as T;
}

describe('config IPC — packaged-app workdir onboarding spine', () => {
  let dir: string;
  let savedWorkdir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roro-ipc-config-'));
    savedWorkdir = process.env.RORO_WORKDIR;
    delete process.env.RORO_WORKDIR;
    setPersistedWorkdir(undefined);
    h.handlers.clear();
    h.getPath.mockReturnValue(dir);
    h.showOpenDialog.mockReset();
    h.fromWebContents.mockReset();
    registerIpcHandlers();
  });

  afterEach(async () => {
    if (savedWorkdir === undefined) delete process.env.RORO_WORKDIR;
    else process.env.RORO_WORKDIR = savedWorkdir;
    setPersistedWorkdir(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('config:get loads userData/config.json and hydrates the resolver', async () => {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    await writeFile(join(dir, 'config.json'), JSON.stringify({ workdir: repo }), 'utf8');

    const result = await handler<() => Promise<unknown>>(CH.configGet)();

    expect(result).toEqual({ workdir: repo, source: 'config' });
    expect(tryResolveWorkdir({}, '/cwd')).toBe(repo);
  });

  it('config:get reports explicit RORO_WORKDIR without clobbering persisted config', async () => {
    await writeFile(join(dir, 'config.json'), '{ corrupt', 'utf8');
    process.env.RORO_WORKDIR = '/env/repo';

    const result = await handler<() => Promise<unknown>>(CH.configGet)();

    expect(result).toEqual({ workdir: '/env/repo', source: 'env' });
    expect(tryResolveWorkdir(process.env, '/cwd')).toBe('/env/repo');
  });

  it('config:chooseWorkdir opens a native directory picker, persists the choice, and hydrates the resolver', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/chosen/repo'] });

    const result = await handler<(event: { sender: unknown }) => Promise<unknown>>(CH.configChooseWorkdir)({
      sender: {},
    });

    expect(h.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/project/i),
        properties: ['openDirectory'],
      }),
    );
    expect(result).toEqual({ workdir: '/chosen/repo', source: 'config' });
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ workdir: '/chosen/repo' });
    expect(tryResolveWorkdir({}, '/cwd')).toBe('/chosen/repo');
  });

  it('config:chooseWorkdir cancel leaves config and resolver unchanged', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handler<(event: { sender: unknown }) => Promise<unknown>>(CH.configChooseWorkdir)({
      sender: {},
    });

    expect(result).toEqual({ source: 'unset' });
    await expect(readFile(join(dir, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(tryResolveWorkdir({}, '/cwd')).toBeUndefined();
  });
});
