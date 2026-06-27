// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionEvent } from '../shared/events';
import type { BootstrapStatusMsg, MemoryHealthStatusMsg, WorkdirConfigMsg } from '../shared/ipc';

vi.mock('./config', () => ({
  loadConfig: () => ({
    modelUrl: undefined as string | undefined,
    floatingWindow: false,
    floatingSmoke: false,
    cosmeticsStore: false,
  }),
  voiceSurfaceEnabled: () => false,
}));

vi.mock('./character/driver', () => ({
  createCharacter: vi.fn(async () => ({
    hasModel: false,
    driver: {
      setState: vi.fn(),
      setBusy: vi.fn(),
      setMuted: vi.fn(),
      setGaze: vi.fn(),
      setMouthOpen: vi.fn(),
      setTalking: vi.fn(),
      setActivity: vi.fn(),
      state: null,
    },
  })),
}));

vi.mock('./character/captions', () => ({
  CaptionPanel: vi.fn().mockImplementation(() => ({ update: vi.fn() })),
  ActionTimeline: vi.fn().mockImplementation(() => ({ append: vi.fn(), marker: vi.fn() })),
}));

vi.mock('./events/actionEvents', () => ({
  subscribeActionEvents: vi.fn(),
}));

vi.mock('./ask/floatingAsk', () => ({
  mountFloatingAsk: vi.fn(),
}));

vi.mock('./confirm/confirmChip', () => ({
  mountConfirmChip: vi.fn(),
}));

vi.mock('./memory/forgetPanel', () => ({
  mountForgetPanel: vi.fn(),
}));

vi.mock('./settings/projectSettings', () => ({
  mountProjectSettings: vi.fn(),
}));

vi.mock('./cosmetics/cosmeticsStore', () => ({
  mountCosmeticsStore: vi.fn(),
}));

vi.mock('./bootstrap/bootstrapBanner', () => ({
  mountBootstrapBanner: vi.fn(),
}));

vi.mock('./bootstrap/workdirBanner', () => ({
  mountWorkdirBanner: vi.fn(),
}));

function setCompanion(stub: unknown): void {
  (window as unknown as { companion?: unknown }).companion = stub;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderApp(): void {
  document.body.innerHTML = `
    <div id="app">
      <canvas id="live2d-canvas"></canvas>
      <div id="overlay">
        <div id="controls"></div>
        <div id="status" role="status" aria-live="polite">Loading...</div>
        <section id="captions">
          <div id="caption-final" class="caption"></div>
          <div id="caption-partial" class="caption partial"></div>
        </section>
        <form id="prompt-form" autocomplete="off">
          <input id="prompt-input" type="text" />
          <button id="send-btn" type="submit">Start</button>
          <button id="cancel-btn" type="button" disabled>Stop</button>
        </form>
        <div id="timeline"></div>
      </div>
    </div>
  `;
}

async function setup(opts: {
  bootstrapStatus?: BootstrapStatusMsg | null;
  memoryHealthStatus?: MemoryHealthStatusMsg | null;
  currentWorkdir?: WorkdirConfigMsg;
  chosenWorkdir?: WorkdirConfigMsg;
} = {}) {
  renderApp();
  let actionCb: ((e: ActionEvent) => void) | null = null;
  let runEndCb: ((p: { runId: string }) => void) | null = null;
  const currentWorkdir = opts.currentWorkdir ?? { source: 'config', workdir: '/tmp/roro-smoke' };
  const chosenWorkdir = opts.chosenWorkdir ?? currentWorkdir;
  const turn = deferred<{ runId: string }>();
  const turnRun = vi.fn(() => turn.promise);
  const cancelTask = vi.fn(async () => undefined);
  setCompanion({
    turnRun,
    cancelTask,
    onActionEvent: (cb: (e: ActionEvent) => void): (() => void) => { actionCb = cb; return () => undefined; },
    onRunEnd: (cb: (p: { runId: string }) => void): (() => void) => { runEndCb = cb; return () => undefined; },
    onBootstrapStatus: (cb: (status: BootstrapStatusMsg | null) => void): (() => void) => {
      if (opts.bootstrapStatus !== undefined) cb(opts.bootstrapStatus);
      return () => undefined;
    },
    getBootstrapStatus: () => Promise.resolve(opts.bootstrapStatus ?? null),
    onMemoryHealthStatus: (cb: (status: MemoryHealthStatusMsg | null) => void): (() => void) => {
      if (opts.memoryHealthStatus !== undefined) cb(opts.memoryHealthStatus);
      return () => undefined;
    },
    getMemoryHealthStatus: () => Promise.resolve(opts.memoryHealthStatus ?? null),
    getWorkdirConfig: () => Promise.resolve(currentWorkdir),
    chooseWorkdir: () => Promise.resolve(chosenWorkdir),
  });
  const { bootstrap } = await import('./bootstrap');
  await bootstrap();

  const form = document.getElementById('prompt-form') as HTMLFormElement;
  const input = document.getElementById('prompt-input') as HTMLInputElement;
  const send = document.getElementById('send-btn') as HTMLButtonElement;
  const cancel = document.getElementById('cancel-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLElement;
  return {
    action: (e: ActionEvent) => actionCb?.(e),
    runEnd: (runId: string) => runEndCb?.({ runId }),
    turn,
    turnRun,
    cancelTask,
    form,
    input,
    send,
    cancel,
    status,
  };
}

const submit = (form: HTMLFormElement): void => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r));

describe('bootstrap typed prompt Stop lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setCompanion(undefined);
    document.body.innerHTML = '';
  });

  it('arms Stop immediately after an accepted submit before run.started', async () => {
    const h = await setup();

    h.input.value = '  explain the status  ';
    submit(h.form);
    await flush();

    expect(h.turnRun).toHaveBeenCalledWith({ transcript: 'explain the status', sessionId: expect.any(String) });
    expect(h.send.disabled).toBe(true);
    expect(h.cancel.disabled).toBe(false);
    expect(h.status.textContent).toBe('Thinking... click Stop if you need to pause.');

    h.cancel.click();
    expect(h.cancelTask).toHaveBeenCalledWith(undefined);
    expect(h.cancel.textContent).toBe('Stopping...');
    expect(h.status.textContent).toBe('Stopping...');
  });

  it('reissues a targeted Stop when the run id resolves after a pre-run Stop click', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.cancel.click();
    expect(h.cancelTask).toHaveBeenCalledWith(undefined);

    h.turn.resolve({ runId: 'late-run' });
    await flush();

    expect(h.cancelTask).toHaveBeenLastCalledWith('late-run');
    expect(h.cancelTask).toHaveBeenCalledTimes(2);
  });

  it('does not reissue a targeted Stop after runEnd has released the typed turn', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.cancel.click();
    h.runEnd('ended-before-ticket');

    h.turn.resolve({ runId: 'late-run' });
    await flush();

    expect(h.cancelTask).toHaveBeenCalledTimes(1);
    expect(h.cancelTask).toHaveBeenCalledWith(undefined);
  });

  it('keeps stopped turns neutral instead of briefly showing task-failure copy', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.cancel.click();
    h.action({ kind: 'run.failed', runId: 'pre-run-stop', ok: false, error: 'stopped', ts: 1 });
    h.runEnd('pre-run-stop');

    expect(h.status.textContent).toBe('Stopped.');
    expect(h.status.textContent).not.toContain('Task hit a problem');
    expect(h.cancel.disabled).toBe(true);
    expect(h.cancel.textContent).toBe('Stop');
    expect(h.send.disabled).toBe(false);
    expect(h.input.value).toBe('');
  });

  it('targets Stop by run id after run.started and ignores unrelated runEnd', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.action({ kind: 'run.started', runId: 'typed-run', agent: 'codex', ts: 1 });
    h.runEnd('other-run');

    expect(h.send.disabled).toBe(true);
    expect(h.cancel.disabled).toBe(false);
    expect(h.input.value).toBe('do it');

    h.cancel.click();
    expect(h.cancelTask).toHaveBeenCalledWith('typed-run');

    h.runEnd('typed-run');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
    expect(h.status.textContent).toBe('Stopped.');
  });

  it('shows a compact memory receipt after an answer turn', async () => {
    const h = await setup();

    h.input.value = 'what did we decide?';
    submit(h.form);
    await flush();
    h.action({ kind: 'status', runId: 'answer-run', text: 'Memory: 0 known facts, 0 related items', ts: 1 });
    h.runEnd('answer-run');

    expect(h.status.textContent).toBe('Done. Memory checked.');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
  });

  it('shows changed files and memory in the receipt after an executor turn', async () => {
    const h = await setup();

    h.input.value = 'edit it';
    submit(h.form);
    await flush();
    h.action({ kind: 'run.started', runId: 'typed-run', agent: 'codex', ts: 1 });
    h.action({ kind: 'status', runId: 'typed-run', text: 'Memory: 2 known facts, 1 related item', ts: 2 });
    h.action({
      kind: 'file_change',
      runId: 'typed-run',
      itemId: 'file-1',
      status: 'completed',
      files: [{ path: 'src/app.ts', op: 'update' }],
      ts: 3,
    });
    h.action({ kind: 'run.completed', runId: 'typed-run', ok: true, finalText: 'done', ts: 4 });
    h.runEnd('typed-run');

    expect(h.status.textContent).toBe('Done. Changed 1 file. Memory used.');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
  });

  it('does not leak receipt context into the next typed turn', async () => {
    const h = await setup();

    h.input.value = 'edit it';
    submit(h.form);
    await flush();
    h.action({ kind: 'run.started', runId: 'typed-run', agent: 'codex', ts: 1 });
    h.action({ kind: 'status', runId: 'typed-run', text: 'Memory: 2 known facts, 1 related item', ts: 2 });
    h.action({
      kind: 'file_change',
      runId: 'typed-run',
      itemId: 'file-1',
      status: 'completed',
      files: [{ path: 'src/app.ts', op: 'update' }],
      ts: 3,
    });
    h.action({ kind: 'run.completed', runId: 'typed-run', ok: true, finalText: 'done', ts: 4 });
    h.runEnd('typed-run');
    expect(h.status.textContent).toBe('Done. Changed 1 file. Memory used.');

    h.input.value = 'what now?';
    submit(h.form);
    await flush();
    h.runEnd('answer-run');

    expect(h.status.textContent).toBe('Done.');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
  });

  it('keeps a runEnd-only cancellation neutral', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.cancel.click();
    h.runEnd('pre-run-stop');

    expect(h.status.textContent).toBe('Stopped.');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
  });

  it('keeps user-requested Stop neutral even when the terminal failure is noisy', async () => {
    const h = await setup();

    h.input.value = 'do it';
    submit(h.form);
    await flush();
    h.action({ kind: 'run.started', runId: 'typed-run', agent: 'codex', ts: 1 });
    h.cancel.click();
    h.action({ kind: 'run.failed', runId: 'typed-run', ok: false, error: 'spawn codex ENOENT', ts: 2 });
    h.runEnd('typed-run');

    expect(h.status.textContent).toBe('Stopped.');
    expect(h.status.textContent).not.toContain('Task hit a problem');
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('');
  });

  it('does not arm Stop or clear the draft when workdir setup is cancelled', async () => {
    const h = await setup({
      currentWorkdir: { source: 'unset' },
      chosenWorkdir: { source: 'unset' },
    });

    h.input.value = 'do it';
    submit(h.form);
    await flush();

    expect(h.turnRun).not.toHaveBeenCalled();
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('do it');
    expect(h.status.textContent).toBe('Choose a project before running a coding task.');
  });

  it('does not arm Stop or clear the draft when the local brain is not ready', async () => {
    const h = await setup({
      bootstrapStatus: {
        ready: false,
        needsOllamaInstall: true,
        missing: [],
        essentialBytes: 0,
      },
    });

    h.input.value = 'do it';
    submit(h.form);
    await flush();

    expect(h.turnRun).not.toHaveBeenCalled();
    expect(h.send.disabled).toBe(false);
    expect(h.cancel.disabled).toBe(true);
    expect(h.input.value).toBe('do it');
    expect(h.status.textContent).toContain('Start Ollama');
  });

  it('does not block typed turns when local memory health is degraded', async () => {
    const h = await setup({
      memoryHealthStatus: {
        state: 'degraded',
        checkedAt: 1,
        reason: 'keychain-unavailable',
        message: 'Local memory is paused.',
      },
    });

    h.input.value = 'do it';
    submit(h.form);
    await flush();

    expect(h.turnRun).toHaveBeenCalledWith({ transcript: 'do it', sessionId: expect.any(String) });
    expect(h.send.disabled).toBe(true);
    expect(h.cancel.disabled).toBe(false);
    expect(document.querySelector('#memory-health-banner')?.textContent).toMatch(/Local memory is paused/);
  });
});
