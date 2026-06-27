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
  let savedDebugBridge: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roro-ipc-config-'));
    savedWorkdir = process.env.RORO_WORKDIR;
    savedDebugBridge = process.env.RORO_DEBUG_BRIDGE;
    delete process.env.RORO_WORKDIR;
    delete process.env.RORO_DEBUG_BRIDGE;
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
    if (savedDebugBridge === undefined) delete process.env.RORO_DEBUG_BRIDGE;
    else process.env.RORO_DEBUG_BRIDGE = savedDebugBridge;
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

  it('config:chooseWorkdir overwrites an existing saved repo and the next resolver read uses the new repo', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ workdir: '/old/repo' }), 'utf8');
    setPersistedWorkdir('/old/repo');
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/new/repo'] });

    const result = await handler<(event: { sender: unknown }) => Promise<unknown>>(CH.configChooseWorkdir)({
      sender: {},
    });

    expect(result).toEqual({ workdir: '/new/repo', source: 'config' });
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ workdir: '/new/repo' });
    expect(tryResolveWorkdir({}, '/cwd')).toBe('/new/repo');
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

  it('config:chooseWorkdir cancel preserves an existing saved repo', async () => {
    const repo = join(dir, 'existing-repo');
    await mkdir(repo);
    await writeFile(join(dir, 'config.json'), JSON.stringify({ workdir: repo }), 'utf8');
    setPersistedWorkdir(repo);
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handler<(event: { sender: unknown }) => Promise<unknown>>(CH.configChooseWorkdir)({
      sender: {},
    });

    expect(result).toEqual({ workdir: repo, source: 'config' });
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ workdir: repo });
    expect(tryResolveWorkdir({}, '/cwd')).toBe(repo);
  });

  it('keeps direct executor, brain, memory, and vision invoke handlers behind RORO_DEBUG_BRIDGE', () => {
    expect(h.handlers.has(CH.runTask)).toBe(false);
    expect(h.handlers.has(CH.brainDecide)).toBe(false);
    expect(h.handlers.has(CH.brainDescribeScreen)).toBe(false);
    expect(h.handlers.has(CH.brainEmbed)).toBe(false);
    expect(h.handlers.has(CH.memoryRemember)).toBe(false);
    expect(h.handlers.has(CH.memoryRecall)).toBe(false);
    expect(h.handlers.has(CH.visionAsk)).toBe(false);
    expect(h.handlers.has(CH.turnRun)).toBe(true);
    expect(h.handlers.has(CH.memoryProfile)).toBe(true);
    expect(h.handlers.has(CH.memoryHealthStatusGet)).toBe(true);
    expect(h.handlers.has(CH.executorReadinessGet)).toBe(true);

    h.handlers.clear();
    process.env.RORO_DEBUG_BRIDGE = '1';
    registerIpcHandlers();

    expect(h.handlers.has(CH.runTask)).toBe(true);
    expect(h.handlers.has(CH.brainDecide)).toBe(true);
    expect(h.handlers.has(CH.brainDescribeScreen)).toBe(true);
    expect(h.handlers.has(CH.brainEmbed)).toBe(true);
    expect(h.handlers.has(CH.memoryRemember)).toBe(true);
    expect(h.handlers.has(CH.memoryRecall)).toBe(true);
    expect(h.handlers.has(CH.visionAsk)).toBe(true);
  });
});
