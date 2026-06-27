import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  originalArgv: [] as string[],
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown): void => {
      h.exposed.set(name, value);
    },
  },
  ipcRenderer: {
    invoke: h.invoke,
    on: h.on,
    removeListener: h.removeListener,
  },
}));

function setArgv(args: string[]): void {
  process.argv.splice(0, process.argv.length, ...args);
}

async function loadPreload(cfg: Record<string, unknown>): Promise<void> {
  vi.resetModules();
  h.exposed.clear();
  const argv = h.originalArgv
    .filter((arg) => !arg.startsWith('--roro-cfg='))
    .concat(`--roro-cfg=${JSON.stringify(cfg)}`);
  setArgv(argv);
  await import('./preload');
}

function namespace(name: string): Record<string, unknown> {
  const value = h.exposed.get(name);
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  return value as Record<string, unknown>;
}

describe('preload exposure gates', () => {
  afterEach(() => {
    setArgv(h.originalArgv);
    h.exposed.clear();
    h.invoke.mockReset();
    h.on.mockReset();
    h.removeListener.mockReset();
    vi.resetModules();
  });

  it('keeps direct executor, brain, memory, and vision handles out of the default product bridge', async () => {
    h.originalArgv = [...process.argv];

    await loadPreload({ debugBridge: false });

    const companion = namespace('companion');
    const brain = namespace('brain');
    const memory = namespace('memory');

    expect(companion.turnRun).toEqual(expect.any(Function));
    expect(companion.onActionEvent).toEqual(expect.any(Function));
    expect(companion.onRunEnd).toEqual(expect.any(Function));
    expect(companion.onMemoryHealthStatus).toEqual(expect.any(Function));
    expect(companion.getMemoryHealthStatus).toEqual(expect.any(Function));
    expect(companion.getExecutorReadiness).toEqual(expect.any(Function));
    expect(companion.refreshBootstrapStatus).toEqual(expect.any(Function));
    expect(companion.runTask).toBeUndefined();

    expect(brain.onReasoning).toEqual(expect.any(Function));
    expect(brain.onContent).toEqual(expect.any(Function));
    expect(brain.decide).toBeUndefined();
    expect(brain.describeScreen).toBeUndefined();
    expect(brain.embed).toBeUndefined();

    expect(memory.profile).toEqual(expect.any(Function));
    expect(memory.remember).toBeUndefined();
    expect(memory.recall).toBeUndefined();
    expect(h.exposed.has('vision')).toBe(false);
  });

  it('exposes direct debug handles only when RORO_DEBUG_BRIDGE is injected into preload config', async () => {
    h.originalArgv = [...process.argv];

    await loadPreload({ debugBridge: true });

    const companion = namespace('companion');
    const brain = namespace('brain');
    const memory = namespace('memory');
    const vision = namespace('vision');

    expect(companion.runTask).toEqual(expect.any(Function));
    expect(brain.decide).toEqual(expect.any(Function));
    expect(brain.describeScreen).toEqual(expect.any(Function));
    expect(brain.embed).toEqual(expect.any(Function));
    expect(memory.remember).toEqual(expect.any(Function));
    expect(memory.recall).toEqual(expect.any(Function));
    expect(vision.ask).toEqual(expect.any(Function));
  });
});
