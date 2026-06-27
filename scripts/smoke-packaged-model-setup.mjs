// scripts/smoke-packaged-model-setup.mjs - packaged local-model setup smoke.
//
// This launches the real packaged .app with a fake Ollama daemon that starts with no
// models installed. It proves the packaged first-run banner exposes the public model
// setup path: missing essentials -> Download button -> streamed pulls -> ready status.
//
// Run after `npm run package`: npm run verify:packaged-model-setup

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}

const APP_BIN = appBinaryPath(process.env.RORO_PACKAGED_APP);
const BOOT_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_MODEL_SETUP_BOOT_TIMEOUT_MS || 120_000);
const PULL_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_MODEL_SETUP_PULL_TIMEOUT_MS || 60_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_MODEL_SETUP_CDP_TIMEOUT_MS || 60_000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';
const REQUIRED_PULLS = ['qwen2.5:3b', 'nomic-embed-text'];

let nextId = 1;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(name);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startFakeOllama() {
  const port = await freePort();
  const installed = new Set();
  const pulls = [];
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/api/tags') {
        sendJson(res, { models: [...installed].map((name) => ({ name })) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/pull') {
        const body = await readJsonBody(req);
        const model = typeof body.model === 'string' ? body.model : '';
        pulls.push(model);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`);
        await sleep(50);
        res.write(`${JSON.stringify({ status: 'downloading', total: 100, completed: 50 })}\n`);
        await sleep(50);
        res.write(`${JSON.stringify({ status: 'verifying sha256 digest', total: 100, completed: 100 })}\n`);
        installed.add(model);
        res.end(`${JSON.stringify({ status: 'success' })}\n`);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/embed') {
        await readJsonBody(req);
        sendJson(res, { embeddings: [Array.from({ length: 768 }, () => 0)] });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err?.message || err));
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return {
    host: `http://127.0.0.1:${port}`,
    pulls,
    installed,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function smokeEnv({ port, ollamaHost }) {
  const env = stripV0DeferredEnv({
    ...process.env,
    RORO_DEBUG_PORT: String(port),
    BRAIN_PROVIDER: 'ollama',
    OLLAMA_HOST: ollamaHost,
    OLLAMA_TIMEOUT_MS: '5000',
  });
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  delete env.RORO_DEBUG_BRIDGE;
  delete env.RORO_FLOATING_WINDOW;
  delete env.RORO_FLOATING_SMOKE;
  delete env.RORO_MEMORY_PANEL_SMOKE;
  delete env.OLLAMA_MODEL;
  delete env.OLLAMA_VISION_MODEL;
  delete env.OLLAMA_EMBED_MODEL;
  delete env.OLLAMA_EMBED_DIM;
  return env;
}

function launchApp({ cwd, userDataDir, port, ollamaHost }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv({ port, ollamaHost }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const run = { child, logs: [], stopping: false };
  const collect = (stream, prefix) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue;
        run.logs.push(`${prefix}${line}`);
        if (!run.stopping && /DevTools listening|brain preflight|bootstrap|error|failed/i.test(line)) {
          console.log(`[app] ${line}`);
        }
      }
    });
  };
  collect(child.stdout, '');
  collect(child.stderr, '');
  return run;
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolveDone) => {
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolveDone(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolveDone(true);
    };
    child.once('close', onClose);
  });
}

async function killApp(run) {
  if (!run) return;
  run.stopping = true;
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
    if (child.exitCode !== null) throw new Error('packaged app exited before CDP target appeared');
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Chromium is still starting.
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
    const { resolve: ok, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timer);
    msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
  });
  const ready = new Promise((ok, reject) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
  });
  const send = (method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) =>
    new Promise((ok, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve: ok, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

async function evaluate(cdp, expression, params = {}, label = 'Runtime.evaluate') {
  let result;
  try {
    result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      ...params,
    });
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
  if (result.exceptionDetails) {
    const details = result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      'unknown exception';
    throw new Error(`${label}: eval failed: ${details}`);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label, params = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(cdp, expression, params, label);
    } catch (err) {
      lastValue = { error: err.message };
      await sleep(250);
      continue;
    }
    if (lastValue) return lastValue;
    await sleep(250);
  }
  throw new Error(`${label} timed out (last=${JSON.stringify(lastValue)})`);
}

function unquoteKeychain(line) {
  return line.trim().replace(/^"|"$/g, '');
}

function runSecurity(args) {
  const res = spawnSync('/usr/bin/security', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(`security ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return res.stdout.trim();
}

function readDefaultKeychain() {
  return unquoteKeychain(runSecurity(['default-keychain', '-d', 'user']));
}

function readKeychainSearchList() {
  return runSecurity(['list-keychains', '-d', 'user'])
    .split(/\r?\n/)
    .map(unquoteKeychain)
    .filter(Boolean);
}

function setDefaultKeychain(path) {
  runSecurity(['default-keychain', '-d', 'user', '-s', path]);
}

function setKeychainSearchList(paths) {
  runSecurity(['list-keychains', '-d', 'user', '-s', ...paths]);
}

function protectKeychainRestore(restore) {
  let restored = false;
  const signalHandlers = new Map();
  const runRestore = () => {
    if (restored) return;
    restored = true;
    process.off('exit', onExit);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    restore();
  };
  const onExit = () => {
    try {
      runRestore();
    } catch {
      // The process is already exiting; do not mask the original termination.
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      try {
        runRestore();
      } catch (err) {
        console.error(`[smoke] keychain restore error during ${signal}: ${err.message}`);
      } finally {
        process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 129);
      }
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  process.once('exit', onExit);
  return runRestore;
}

function installTemporaryKeychain(rootDir) {
  const previousDefault = readDefaultKeychain();
  const previousSearchList = readKeychainSearchList();
  const keychainPath = join(rootDir, 'roro-packaged-model-setup-smoke.keychain-db');
  const password = randomUUID();

  runSecurity(['create-keychain', '-p', password, keychainPath]);
  runSecurity(['set-keychain-settings', '-lut', '21600', keychainPath]);
  runSecurity(['unlock-keychain', '-p', password, keychainPath]);
  setKeychainSearchList([keychainPath]);
  setDefaultKeychain(keychainPath);
  console.log(`[smoke] using temporary unlocked keychain for safeStorage (${keychainPath})...`);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    const errors = [];
    try {
      setKeychainSearchList(previousSearchList);
    } catch (err) {
      errors.push(err.message);
    }
    try {
      if (previousDefault) setDefaultKeychain(previousDefault);
    } catch (err) {
      errors.push(err.message);
    }
    if (errors.length > 0) throw new Error(`failed to restore keychain settings: ${errors.join('; ')}`);
  };
}

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged model-setup smoke currently targets the darwin .app bundle.');
  process.exit(1);
}
if (!existsSync(APP_BIN)) {
  console.error(`[smoke] missing packaged app: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-model-setup-'));
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
let fakeOllama;
let run;
let cdp;
let restoreKeychain = () => {};

try {
  await mkdir(cwd, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  restoreKeychain = protectKeychainRestore(installTemporaryKeychain(root));
  fakeOllama = await startFakeOllama();
  const port = await freePort();

  console.log(
    `[smoke] launching packaged app for model setup ` +
      `(userData=${userDataDir}, RORO_DEBUG_PORT=${port}, Ollama=${fakeOllama.host})...`,
  );
  run = launchApp({ cwd, userDataDir, port, ollamaHost: fakeOllama.host });
  const target = await waitForRendererTarget(port, run.child);
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const initial = await waitFor(
    cdp,
    `(() => {
      const banner = document.getElementById('bootstrap-banner');
      const download = document.getElementById('bootstrap-download');
      if (!banner || banner.hidden || !download) return false;
      const status = window.companion?.getBootstrapStatus;
      return {
        href: location.href,
        bodyText: document.body.innerText.slice(0, 1000),
        bannerText: banner.textContent ?? '',
        downloadText: download.textContent ?? '',
        downloadDisabled: download.disabled,
        getOllamaExists: Boolean(document.getElementById('bootstrap-get-ollama')),
        runTaskType: typeof window.companion?.runTask,
        brainDecideType: typeof window.brain?.decide,
        memoryRememberType: typeof window.memory?.remember,
        bootstrapStatusType: typeof status,
      };
    })()`,
    BOOT_TIMEOUT_MS,
    'packaged missing-model banner',
  );

  check(
    'packaged renderer URL is file:// app.asar',
    initial.href.startsWith('file://') && initial.href.includes('/Roro.app/Contents/Resources/app.asar/'),
    JSON.stringify(initial),
  );
  check('renderer body is not blank', initial.bodyText.includes('Roro'), JSON.stringify(initial));
  check('missing-model banner is visible', /core models/i.test(initial.bannerText), initial.bannerText);
  check('download button discloses size', /Download \(~2\.2 GB\)/.test(initial.downloadText), initial.downloadText);
  check('Ollama install button is absent when daemon is reachable', initial.getOllamaExists === false, JSON.stringify(initial));
  check('debug runTask bridge is absent', initial.runTaskType === 'undefined', JSON.stringify(initial));
  check('direct brain decide bridge is absent', initial.brainDecideType === 'undefined', JSON.stringify(initial));
  check('direct memory remember bridge is absent', initial.memoryRememberType === 'undefined', JSON.stringify(initial));
  check('public bootstrap status bridge exists', initial.bootstrapStatusType === 'function', JSON.stringify(initial));

  const beforeStatus = await evaluate(
    cdp,
    `window.companion.getBootstrapStatus()
      .then((status) => ({ ok: true, status }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'initial bootstrap status',
  );
  check('initial bootstrap status resolves', beforeStatus.ok === true, JSON.stringify(beforeStatus));
  check('initial bootstrap status is not ready', beforeStatus.status?.ready === false, JSON.stringify(beforeStatus));
  check('initial bootstrap status lists essential missing models', REQUIRED_PULLS.every((name) =>
    beforeStatus.status?.missing?.some((model) => model.name === name)), JSON.stringify(beforeStatus));

  await evaluate(
    cdp,
    `(() => {
      document.getElementById('bootstrap-download')?.click();
      return true;
    })()`,
    {},
    'click packaged model download',
  );

  const inFlight = await waitFor(
    cdp,
    `(() => {
      const banner = document.getElementById('bootstrap-banner');
      const download = document.getElementById('bootstrap-download');
      const text = banner?.textContent ?? '';
      if (!/Downloading /.test(text) && !download?.disabled) return false;
      return { text, disabled: download?.disabled ?? null };
    })()`,
    PULL_TIMEOUT_MS,
    'packaged model download progress',
  );
  check('download progress is visible', /Downloading /.test(inFlight.text) || inFlight.disabled === true, JSON.stringify(inFlight));

  const readyUi = await waitFor(
    cdp,
    `(() => {
      const banner = document.getElementById('bootstrap-banner');
      const text = banner?.textContent ?? '';
      if (!/Models ready/i.test(text)) return false;
      return {
        text,
        downloadExists: Boolean(document.getElementById('bootstrap-download')),
      };
    })()`,
    PULL_TIMEOUT_MS,
    'packaged models-ready banner',
  );
  check('models-ready copy is visible', /Models ready/i.test(readyUi.text), JSON.stringify(readyUi));
  check('download button is removed after success', readyUi.downloadExists === false, JSON.stringify(readyUi));

  const afterStatus = await evaluate(
    cdp,
    `window.companion.getBootstrapStatus()
      .then((status) => ({ ok: true, status }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'ready bootstrap status',
  );
  check('ready bootstrap status resolves', afterStatus.ok === true, JSON.stringify(afterStatus));
  check('ready bootstrap status is ready', afterStatus.status?.ready === true, JSON.stringify(afterStatus));
  check('ready bootstrap status has no missing models', afterStatus.status?.missing?.length === 0, JSON.stringify(afterStatus));
  check('fake Ollama pulled exactly the essential models', JSON.stringify(fakeOllama.pulls) === JSON.stringify(REQUIRED_PULLS), JSON.stringify(fakeOllama.pulls));

  const joinedLogs = run.logs.join('\n');
  check('packaged model-setup logs have no memory keychain failure', !/OS keychain unavailable|memory store is locked|cannot encrypt memory|errSecAuthFailed/i.test(joinedLogs), joinedLogs.slice(-1000));
  check('packaged model-setup logs have no broken-pipe crash', !/write EPIPE|A JavaScript error occurred/i.test(joinedLogs), joinedLogs.slice(-1000));
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  cdp?.close();
  await killApp(run);
  if (fakeOllama) await fakeOllama.close();
  try {
    restoreKeychain();
  } catch (err) {
    console.error(`[smoke] keychain restore error: ${err.message}`);
    failures.push(`keychain restore: ${err.message}`);
  }
  if (KEEP) console.log(`[smoke] kept disposable home at ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log('\n[smoke] PASS - packaged local-model setup completed through the public bootstrap banner.');
