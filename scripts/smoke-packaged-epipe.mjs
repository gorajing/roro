// scripts/smoke-packaged-epipe.mjs - packaged closed-pipe regression smoke.
//
// This launches the real packaged .app with stdout/stderr pipes immediately closed from
// the parent side. That reproduces the production-style "write EPIPE" condition that
// used to surface Electron's "JavaScript error occurred in the main process" dialog.
// It also forces a local-Ollama outage and submits a typed task from a configured repo,
// proving the renderer's brain-readiness gate blocks a doomed first coding turn.
//
// Run after `npm run package`: npm run verify:epipe

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const BOOT_TIMEOUT_MS = Number(process.env.RORO_EPIPE_BOOT_TIMEOUT_MS || 120_000);
const STABILITY_MS = Number(process.env.RORO_EPIPE_STABILITY_MS || 3_000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged EPIPE smoke currently targets the darwin .app bundle.');
  process.exit(1);
}

const APP_BIN = resolve(
  process.env.RORO_PACKAGED_APP ||
    `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`,
);

let nextId = 1;
const failures = [];

function check(name, cond) {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  fail ${name}`);
    failures.push(name);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolvePort(port);
        else reject(new Error('could not allocate a debug port'));
      });
    });
  });
}

function smokeEnv(home, port, ollamaPort) {
  const env = {
    ...process.env,
    HOME: home,
    RORO_DEBUG_PORT: String(port),
    BRAIN_PROVIDER: 'ollama',
    OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`,
    OLLAMA_TIMEOUT_MS: '250',
  };
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  delete env.RORO_STT_VOICE;
  delete env.RORO_TTS_VOICE;
  return env;
}

function launchApp({ home, cwd, userDataDir, port, ollamaPort }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv(home, port, ollamaPort),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.on('error', (err) => {
    failures.push(`spawn: ${err.message}`);
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('error', () => {
      // Parent-side stream teardown is intentional in this smoke.
    });
    stream?.destroy();
  }

  return { child };
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('close', onClose);
  });
}

async function killApp(run) {
  if (!run.child.pid) return;
  try {
    process.kill(-run.child.pid, 'SIGTERM');
  } catch {
    try {
      run.child.kill();
    } catch {
      // already gone
    }
  }
  if (await waitForChildExit(run.child, 5000)) return;
  try {
    process.kill(-run.child.pid, 'SIGKILL');
  } catch {
    try {
      run.child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  await waitForChildExit(run.child, 2000);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRendererTarget(port, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app exited before renderer CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // port not up yet, or Chromium is still starting
    }
    await sleep(500);
  }
  throw new Error(`renderer CDP target never appeared on port ${port}`);
}

function cdpClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve: ok, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
  });
  const ready = new Promise((ok, reject) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
  });
  const send = (method, params = {}) =>
    new Promise((ok, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: ok, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

async function evaluate(cdp, expression, params = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    ...params,
  });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function waitForBootstrapStatus(cdp, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app exited before bootstrap status appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    const status = await evaluate(
      cdp,
      `window.companion?.getBootstrapStatus?.()
        .then((status) => ({ ok: true, status }))
        .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
      { awaitPromise: true },
    );
    if (status?.ok && status.status) return status.status;
    await sleep(500);
  }
  throw new Error('bootstrap status never appeared');
}

async function inspectRenderer(target, child) {
  const cdp = cdpClient(target.webSocketDebuggerUrl);
  try {
    await cdp.ready;
    await cdp.send('Runtime.enable');
    const dom = await evaluate(cdp, `(() => ({
      title: document.title,
      href: location.href,
      bodyText: document.body.innerText.slice(0, 500),
      hasTopbar: !!document.querySelector('#topbar'),
      hasPromptForm: !!document.querySelector('#prompt-form'),
    }))()`);
    const bootstrapStatus = await waitForBootstrapStatus(cdp, child);
    const brainGate = await evaluate(
      cdp,
      `new Promise((resolve) => {
        const input = document.querySelector('#prompt-input');
        const form = document.querySelector('#prompt-form');
        const send = document.querySelector('#send-btn');
        const status = document.querySelector('#status');
        input.value = 'create a tiny smoke file';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        setTimeout(() => resolve({
          inputValue: input.value,
          sendDisabled: send.disabled,
          statusText: status.textContent,
        }), 750);
      })`,
      { awaitPromise: true },
    );
    return { dom, bootstrapStatus, brainGate };
  } finally {
    cdp.close();
  }
}

async function assertStillRunning(child, timeoutMs) {
  const exited = await waitForChildExit(child, timeoutMs);
  if (!exited) return;
  throw new Error(`app exited during closed-pipe stability window (code=${child.exitCode}, signal=${child.signalCode})`);
}

try {
  await access(APP_BIN);
} catch {
  console.error(`[smoke] missing packaged app: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-epipe-'));
const home = join(root, 'home');
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
const scratchRepo = join(root, 'chosen-project');
await mkdir(home, { recursive: true });
await mkdir(cwd, { recursive: true });
await mkdir(userDataDir, { recursive: true });
await mkdir(scratchRepo, { recursive: true });
await writeFile(join(userDataDir, 'config.json'), JSON.stringify({ workdir: scratchRepo }, null, 2), 'utf8');

let run;
try {
  const port = await freePort();
  const ollamaPort = await freePort();
  console.log(
    `[smoke] launching packaged app with closed stdout/stderr ` +
      `(HOME=${home}, userData=${userDataDir}, RORO_DEBUG_PORT=${port}, OLLAMA_HOST=127.0.0.1:${ollamaPort})...`,
  );
  run = launchApp({ home, cwd, userDataDir, port, ollamaPort });

  const target = await waitForRendererTarget(port, run.child);
  check('renderer CDP target appears while stdio pipes are closed', Boolean(target.webSocketDebuggerUrl));

  const { dom, bootstrapStatus, brainGate } = await inspectRenderer(target, run.child);
  check(
    'renderer URL is packaged file:// app.asar',
    dom.href.startsWith('file://') && dom.href.includes('/Roro.app/Contents/Resources/app.asar/'),
  );
  check('renderer body is not blank', typeof dom.bodyText === 'string' && dom.bodyText.includes('Roro'));
  check('#topbar exists', dom.hasTopbar);
  check('#prompt-form exists', dom.hasPromptForm);
  check(
    'bootstrap status reports forced local Ollama outage',
    bootstrapStatus.ready === false && bootstrapStatus.needsOllamaInstall === true,
  );
  check(
    'typed task is blocked before dispatch when local brain is not ready',
    /start ollama/i.test(brainGate.statusText) &&
      brainGate.inputValue === 'create a tiny smoke file' &&
      brainGate.sendDisabled === false,
  );

  await assertStillRunning(run.child, STABILITY_MS);
  check(`app stays alive for ${STABILITY_MS}ms after renderer is responsive`, true);
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  if (run) await killApp(run);
  if (KEEP) console.log(`[smoke] kept disposable home at ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log('\n[smoke] PASS - packaged app boots with closed stdout/stderr pipes.');
