// scripts/smoke-packaged-first-task.mjs — packaged first coding task smoke.
//
// This launches the real packaged .app with a persisted userData/config.json, a fake
// local Ollama daemon, and by default a fake Codex binary. It proves the packaged product path
// exposes the public readiness bridge and can complete its first typed coding task:
//   persisted project -> brain readiness -> public executor readiness check -> turnRun -> Codex JSONL -> file on disk.
//
// Run after `npm run package`: npm run verify:packaged-first-task
//
// For a human-owned release/cohort preflight, run `npm run verify:packaged-real-codex`.
// That mode keeps fake Ollama for deterministic brain decisions, but uses the real local Codex CLI
// and its real auth/config instead of injecting RORO_CODEX_BIN. It is intentionally opt-in and not a CI gate.

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}

const APP_BIN = appBinaryPath(process.env.RORO_PACKAGED_APP);
const REAL_CODEX = process.env.RORO_PACKAGED_FIRST_TASK_REAL_CODEX === '1';
const REAL_CODEX_USE_ENV_BIN = process.env.RORO_PACKAGED_REAL_CODEX_USE_ENV_BIN === '1';
const BOOT_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_FIRST_TASK_BOOT_TIMEOUT_MS || 120_000);
const TURN_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_FIRST_TASK_TURN_TIMEOUT_MS || (REAL_CODEX ? 300_000 : 180_000));
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_PACKAGED_FIRST_TASK_CDP_TIMEOUT_MS || 60_000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';
const TASK_FILE = 'roro-packaged-first-task-smoke.txt';
const TASK_CONTENT = 'packaged first task ok';
const CODEX_MODE = REAL_CODEX ? 'real Codex CLI' : 'fake Codex';

let nextId = 1;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` - ${detail}` : ''}`);
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

function fakeEmbedding() {
  return Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
}

function sendJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function currentTranscriptFromPrompt(prompt) {
  const prefix = 'USER SAID: ';
  const lines = prompt.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith(prefix)) continue;
    const raw = line.slice(prefix.length).trim();
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw;
    }
  }
  return prompt;
}

async function startFakeOllama() {
  const port = await freePort();
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/api/tags') {
        sendJson(res, {
          models: [
            { name: 'qwen2.5:3b' },
            { name: 'qwen2.5vl:7b' },
            { name: 'nomic-embed-text:latest' },
          ],
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/embed') {
        const body = await readJsonBody(req);
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        sendJson(res, { embeddings: inputs.map(() => fakeEmbedding()) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJsonBody(req);
        const prompt = Array.isArray(body.messages)
          ? body.messages.map((message) => message?.content ?? '').join('\n')
          : '';
        const transcript = currentTranscriptFromPrompt(prompt);
        const decisionPayload = transcript.includes(TASK_FILE)
          ? {
            narration: 'On it. I will create the packaged first-task smoke file.',
            command: 'run_agent',
            args: {
              task: `Create ${TASK_FILE} whose entire contents are exactly:\n${TASK_CONTENT}`,
              cwd: null,
            },
          }
          : { narration: 'packaged first task smoke ready', command: 'answer', args: {} };
        const decision = JSON.stringify(decisionPayload);
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(`${JSON.stringify({ message: { content: decision }, done: false })}\n`);
          res.end(`${JSON.stringify({ done: true })}\n`);
        } else {
          sendJson(res, { message: { content: decision } });
        }
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
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function writeFakeCodexBin(path, argsFile) {
  const scriptPath = `${path}.js`;
  await writeFile(scriptPath, `
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const cwdIndex = args.indexOf('-C');
const repo = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
const file = join(repo, ${JSON.stringify(TASK_FILE)});
const content = ${JSON.stringify(TASK_CONTENT)};
const argsFile = ${JSON.stringify(argsFile)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (event) => console.log(JSON.stringify(event));

(async () => {
  const invocations = (() => {
    try {
      const existing = JSON.parse(readFileSync(argsFile, 'utf8'));
      return Array.isArray(existing) ? existing : [];
    } catch {
      return [];
    }
  })();
  invocations.push({ args, repo });
  writeFileSync(argsFile, JSON.stringify(invocations, null, 2), 'utf8');

  emit({ type: 'thread.started', thread_id: 'fake-codex-packaged-first-task' });
  emit({ type: 'turn.started' });
  await sleep(100);
  emit({
    type: 'item.started',
    item: {
      id: 'fake-packaged-file',
      type: 'file_change',
      changes: [{ path: file, kind: 'add' }],
      status: 'in_progress',
    },
  });
  writeFileSync(file, content, 'utf8');
  await sleep(250);
  emit({
    type: 'item.completed',
    item: {
      id: 'fake-packaged-file',
      type: 'file_change',
      changes: [{ path: file, kind: 'add' }],
      status: 'completed',
    },
  });
  emit({
    type: 'item.completed',
    item: {
      id: 'fake-packaged-message',
      type: 'agent_message',
      text: 'Created the packaged first-task smoke file.',
      status: 'completed',
    },
  });
  emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
})().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
`, 'utf8');
  await writeFile(path, `#!/bin/sh
exec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"
`, 'utf8');
  await chmod(path, 0o755);
}

function smokeEnv({ port, ollamaHost, fakeCodexBin, realCodex }) {
  const env = stripV0DeferredEnv({ ...process.env });
  Object.assign(env, {
    BRAIN_PROVIDER: 'ollama',
    OLLAMA_HOST: ollamaHost,
    OLLAMA_TIMEOUT_MS: '5000',
    RORO_DEBUG_PORT: String(port),
  });
  if (realCodex) {
    // Simulate an ordinary packaged launch rather than a shell-rich dev launch: prove common-dir
    // discovery (/opt/homebrew/bin, /usr/local/bin, etc.) unless a maintainer deliberately opts into
    // an env override for a nonstandard Codex install.
    env.PATH = process.env.RORO_PACKAGED_REAL_CODEX_PATH || '/usr/bin:/bin';
    if (!REAL_CODEX_USE_ENV_BIN) delete env.RORO_CODEX_BIN;
  } else {
    env.RORO_CODEX_BIN = fakeCodexBin;
  }
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

function launchApp({ cwd, userDataDir, port, ollamaHost, fakeCodexBin, realCodex }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv({ port, ollamaHost, fakeCodexBin, realCodex }),
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
        if (!run.stopping && /DevTools listening|brain preflight|config|executor|memory|error|failed/i.test(line)) {
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
  run.stopping = true;
  if (!run.child.pid) return;
  try {
    process.kill(-run.child.pid, 'SIGTERM');
  } catch {
    try { run.child.kill(); } catch { /* already gone */ }
  }
  if (await waitForChildExit(run.child, 5000)) return;
  try {
    process.kill(-run.child.pid, 'SIGKILL');
  } catch {
    try { run.child.kill('SIGKILL'); } catch { /* already gone */ }
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
      throw new Error(`app exited before CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
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
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
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
  const keychainPath = join(rootDir, 'roro-packaged-first-task-smoke.keychain-db');
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
    if (errors.length > 0) {
      throw new Error(`failed to restore keychain settings: ${errors.join('; ')}`);
    }
  };
}

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged first-task smoke currently targets the darwin .app bundle.');
  process.exit(1);
}
if (!existsSync(APP_BIN)) {
  console.error(`[smoke] missing packaged app: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-first-task-'));
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
const projectDir = join(root, 'chosen-project');
const fakeCodexBin = join(root, 'fake-codex');
const fakeCodexArgsFile = join(root, 'fake-codex-args.json');
const configPath = join(userDataDir, 'config.json');
let fakeOllama;
let run;
let cdp;
let restoreKeychain = () => {};

try {
  await mkdir(cwd, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(dirname(configPath), { recursive: true });
  spawnSync('git', ['init', projectDir], { stdio: 'ignore' });
  await writeFile(configPath, JSON.stringify({ workdir: projectDir }, null, 2), 'utf8');
  if (!REAL_CODEX) await writeFakeCodexBin(fakeCodexBin, fakeCodexArgsFile);
  restoreKeychain = protectKeychainRestore(installTemporaryKeychain(root));
  fakeOllama = await startFakeOllama();
  const port = await freePort();

  console.log(
    `[smoke] launching packaged app for first coding task with ${CODEX_MODE} ` +
      `(userData=${userDataDir}, project=${projectDir}, RORO_DEBUG_PORT=${port}, Ollama=${fakeOllama.host})...`,
  );
  if (REAL_CODEX && !REAL_CODEX_USE_ENV_BIN) {
    console.log('[smoke] real Codex mode strips RORO_CODEX_BIN and narrows PATH to prove packaged CLI discovery.');
  }
  run = launchApp({
    cwd,
    userDataDir,
    port,
    ollamaHost: fakeOllama.host,
    fakeCodexBin,
    realCodex: REAL_CODEX,
  });

  const target = await waitForRendererTarget(port, run.child);
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  await waitFor(
    cdp,
    `(() => {
      if (!document.getElementById('prompt-form')) return false;
      if (!document.getElementById('workdir-banner')) return false;
      if (document.body?.classList.contains('floating-window')) return false;
      return window.companion?.getWorkdirConfig?.()
        .then((config) => config?.source === 'config' && config?.workdir === ${JSON.stringify(projectDir)})
        .catch(() => false);
    })()`,
    BOOT_TIMEOUT_MS,
    'typed packaged prompt and workdir banner mount',
    { awaitPromise: true },
  );

  const initial = await evaluate(cdp, `(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0;
    };
    return {
      title: document.title,
      href: location.href,
      bodyText: document.body?.innerText?.slice(0, 800) ?? '',
      bodyFloating: document.body?.classList.contains('floating-window') ?? false,
      promptVisible: visible('#prompt-form') && visible('#prompt-input') && visible('#send-btn'),
      workdirHidden: document.querySelector('#workdir-banner')?.hidden ?? null,
      workdirVisible: visible('#workdir-banner'),
      placeholder: document.getElementById('prompt-input')?.getAttribute('placeholder') ?? '',
      sendDisabled: document.getElementById('send-btn')?.disabled ?? null,
      cancelDisabled: document.getElementById('cancel-btn')?.disabled ?? null,
      turnRun: typeof window.companion?.turnRun,
      cancelTask: typeof window.companion?.cancelTask,
      onActionEvent: typeof window.companion?.onActionEvent,
      onRunEnd: typeof window.companion?.onRunEnd,
      getBootstrapStatus: typeof window.companion?.getBootstrapStatus,
      getWorkdirConfig: typeof window.companion?.getWorkdirConfig,
      getExecutorReadiness: typeof window.companion?.getExecutorReadiness,
      runTask: typeof window.companion?.runTask,
      companionDebug: typeof window.__companion,
      brainDecide: typeof window.brain?.decide,
      memoryRemember: typeof window.memory?.remember,
    };
  })()`, {}, 'initial DOM and bridge check');
  check(
    'packaged renderer URL is file:// app.asar',
    initial.href.startsWith('file://') && initial.href.includes('/Roro.app/Contents/Resources/app.asar/'),
    JSON.stringify(initial),
  );
  check('renderer body is not blank', initial.bodyText.includes('Roro'), JSON.stringify(initial));
  check('packaged first-task smoke uses the default typed surface', initial.bodyFloating === false, JSON.stringify(initial));
  check('typed prompt is visibly rendered and ready', initial.promptVisible && initial.sendDisabled === false && initial.cancelDisabled === true, JSON.stringify(initial));
  check('typed prompt placeholder is product-facing', /ask roro to work/i.test(initial.placeholder), JSON.stringify(initial));
  check('persisted project hides first-run workdir banner', initial.workdirHidden === true && initial.workdirVisible === false, JSON.stringify(initial));
  check('public turnRun bridge exists', initial.turnRun === 'function', JSON.stringify(initial));
  check('public cancelTask bridge exists', initial.cancelTask === 'function', JSON.stringify(initial));
  check('public action-event bridge exists', initial.onActionEvent === 'function', JSON.stringify(initial));
  check('public runEnd bridge exists', initial.onRunEnd === 'function', JSON.stringify(initial));
  check('public bootstrap status bridge exists', initial.getBootstrapStatus === 'function', JSON.stringify(initial));
  check('public workdir config bridge exists', initial.getWorkdirConfig === 'function', JSON.stringify(initial));
  check('public executor readiness bridge exists', initial.getExecutorReadiness === 'function', JSON.stringify(initial));
  check('direct runTask debug bridge is absent', initial.runTask === 'undefined', JSON.stringify(initial));
  check('__companion debug handle is absent', initial.companionDebug === 'undefined', JSON.stringify(initial));
  check('direct brain decide bridge is absent', initial.brainDecide === 'undefined', JSON.stringify(initial));
  check('direct memory remember bridge is absent', initial.memoryRemember === 'undefined', JSON.stringify(initial));

  const bootstrap = await waitFor(
    cdp,
    `window.companion.getBootstrapStatus()
      .then((status) => status?.ready ? ({ ok: true, status }) : false)
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    BOOT_TIMEOUT_MS,
    'packaged local brain readiness',
    { awaitPromise: true },
  );
  check('packaged local Ollama brain is ready', bootstrap.ok === true, bootstrap.message || JSON.stringify(bootstrap.status));

  const workdirConfig = await evaluate(
    cdp,
    `window.companion.getWorkdirConfig()
      .then((config) => ({ ok: true, config }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'workdir config check',
  );
  check(
    'workdir gate sees the persisted project before submit',
    workdirConfig.ok === true &&
      workdirConfig.config?.source === 'config' &&
      workdirConfig.config?.workdir === projectDir,
    workdirConfig.message || JSON.stringify(workdirConfig.config),
  );

  const executorReadiness = await evaluate(
    cdp,
    `window.companion.getExecutorReadiness()
      .then((status) => ({ ok: true, status }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'executor readiness check',
  );
  if (REAL_CODEX) {
    check(
      'packaged executor readiness resolves to a real Codex CLI',
      executorReadiness.ok === true &&
        executorReadiness.status?.ready === true &&
        executorReadiness.status?.agent === 'codex' &&
        executorReadiness.status?.path !== fakeCodexBin &&
        (REAL_CODEX_USE_ENV_BIN
          ? executorReadiness.status?.source === 'env'
          : ['common', 'path'].includes(executorReadiness.status?.source)),
      executorReadiness.message || JSON.stringify(executorReadiness.status),
    );
  } else {
    check(
      'packaged executor readiness resolves to fake Codex override',
      executorReadiness.ok === true &&
        executorReadiness.status?.ready === true &&
        executorReadiness.status?.source === 'env' &&
        executorReadiness.status?.path === fakeCodexBin,
      executorReadiness.message || JSON.stringify(executorReadiness.status),
    );
  }

  await evaluate(cdp, `(() => {
    window.__roroPackagedFirstTask = { events: [], runEnds: [] };
    window.companion.onActionEvent((event) => window.__roroPackagedFirstTask.events.push(event));
    window.companion.onRunEnd((runEnd) => window.__roroPackagedFirstTask.runEnds.push(runEnd));
    return true;
  })()`, {}, 'stream probe install');

  const transcript = `Create ${TASK_FILE} with ${TASK_CONTENT.trim()} as its contents.`;
  const submit = await evaluate(cdp, `(() => {
    const input = document.getElementById('prompt-input');
    const form = document.getElementById('prompt-form');
    input.value = ${JSON.stringify(transcript)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { defaultPrevented: !notCanceled, value: input.value };
  })()`, {}, 'typed packaged form submit');
  check('typed form submit listener prevents native navigation', submit.defaultPrevented === true, JSON.stringify(submit));

  const accepted = await waitFor(
    cdp,
    `(() => {
      const input = document.getElementById('prompt-input');
      const send = document.getElementById('send-btn');
      const cancel = document.getElementById('cancel-btn');
      const status = document.getElementById('status');
      if (!send?.disabled || cancel?.disabled) return false;
      return {
        inputValue: input?.value ?? '',
        sendDisabled: send.disabled,
        cancelDisabled: cancel.disabled,
        cancelText: cancel.textContent,
        statusText: status?.textContent ?? '',
      };
    })()`,
    10_000,
    'typed packaged accepted state',
  );
  check('typed input keeps the first packaged task visible while in flight', accepted.inputValue.includes(TASK_FILE), JSON.stringify(accepted));
  check('typed Stop arms after readiness gates pass', accepted.cancelDisabled === false && accepted.cancelText === 'Stop', JSON.stringify(accepted));

  const turn = await waitFor(
    cdp,
    `(() => {
      const probe = window.__roroPackagedFirstTask;
      if (!probe?.runEnds?.length) return false;
      const runEnd = probe.runEnds[probe.runEnds.length - 1];
      const events = probe.events.filter((event) => event?.runId === runEnd.runId);
      return { runEnd, events, allEvents: probe.events };
    })()`,
    TURN_TIMEOUT_MS,
    'packaged first coding task runEnd',
  );
  const events = Array.isArray(turn.events) ? turn.events : [];
  const fileEvents = events.filter((event) => event?.kind === 'file_change');
  const memoryStatus = events.find((event) => event?.kind === 'status' && /^Memory:/.test(event.text ?? ''));
  check('packaged first task produced scoped events', events.length > 0, JSON.stringify(turn.allEvents ?? []));
  check('packaged first task emitted a memory status beat', Boolean(memoryStatus), JSON.stringify(events));
  check(`packaged first task emitted run.started from ${CODEX_MODE}`, events.some((event) =>
    event?.kind === 'run.started' &&
    event.agent === 'codex' &&
    (REAL_CODEX || event.threadId === 'fake-codex-packaged-first-task')), JSON.stringify(events));
  check(`packaged first task emitted completed file_change${REAL_CODEX ? ' or wrote the file through a command' : ''}`, REAL_CODEX
    ? (
      fileEvents.some((event) =>
        event.status === 'completed' &&
        event.files?.some((file) => file.path?.endsWith(TASK_FILE))) ||
      await readFile(join(projectDir, TASK_FILE), 'utf8').then((text) => text === TASK_CONTENT).catch(() => false)
    )
    : fileEvents.some((event) =>
    event.status === 'completed' &&
    event.files?.some((file) => file.path?.endsWith(TASK_FILE))), JSON.stringify(events));
  check('packaged first task emitted run.completed', events.some((event) => event?.kind === 'run.completed'), JSON.stringify(events));
  check('packaged first task produced no run.failed event', !events.some((event) => event?.kind === 'run.failed'), JSON.stringify(events));

  const released = await waitFor(
    cdp,
    `(() => {
      const input = document.getElementById('prompt-input');
      const send = document.getElementById('send-btn');
      const cancel = document.getElementById('cancel-btn');
      const status = document.getElementById('status');
      if (send?.disabled || !cancel?.disabled || input?.value !== '') return false;
      return {
        statusText: status?.textContent ?? '',
        sendDisabled: send.disabled,
        cancelDisabled: cancel.disabled,
        cancelText: cancel.textContent,
        inputValue: input.value,
      };
    })()`,
    5000,
    'typed packaged UI release',
  );
  check(
    'typed form reports the changed file after packaged first task',
    /^Done\. Changed 1 file\.( Memory (used|checked)\.)?$/.test(released.statusText),
    JSON.stringify(released),
  );
  check('typed form returns to ready state after packaged first task', released.cancelText === 'Stop', JSON.stringify(released));

  if (REAL_CODEX) {
    check(
      'real Codex wrote the requested project file',
      await readFile(join(projectDir, TASK_FILE), 'utf8').then((text) => text === TASK_CONTENT).catch(() => false),
    );
    check(
      'real Codex mode did not inject the fake executor override',
      executorReadiness.status?.path !== fakeCodexBin && (REAL_CODEX_USE_ENV_BIN || executorReadiness.status?.source !== 'env'),
      JSON.stringify(executorReadiness.status),
    );
  } else {
    const codexInvocations = await readFile(fakeCodexArgsFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => []);
    const expectedCodexPrefix = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', projectDir];
    const receivedCodexArgs = Array.isArray(codexInvocations)
      ? codexInvocations.map((invocation) => invocation?.args).filter(Array.isArray)
      : [];
    check(
      'fake Codex received the packaged executor CLI shape',
      receivedCodexArgs.some((args) =>
        JSON.stringify(args.slice(0, expectedCodexPrefix.length)) === JSON.stringify(expectedCodexPrefix) &&
        args.at(-1)?.includes(TASK_FILE)),
      JSON.stringify(codexInvocations),
    );
    check(
      'fake Codex wrote the requested project file',
      await readFile(join(projectDir, TASK_FILE), 'utf8').then((text) => text === TASK_CONTENT).catch(() => false),
    );
    check(
      'packaged app did not read a developer env workdir override',
      !codexInvocations.some((invocation) => invocation?.repo === process.cwd()),
      JSON.stringify(codexInvocations),
    );
  }

  const joinedLogs = run.logs.join('\n');
  check('packaged first-task logs have no memory keychain failure', !/OS keychain unavailable|memory store is locked|cannot encrypt memory|errSecAuthFailed/i.test(joinedLogs), joinedLogs.slice(-1000));
  check('packaged first-task logs have no broken-pipe crash', !/write EPIPE|A JavaScript error occurred/i.test(joinedLogs), joinedLogs.slice(-1000));
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  cdp?.close();
  if (run) await killApp(run);
  await fakeOllama?.close();
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

console.log(`\n[smoke] PASS — packaged first coding task completed through public turnRun with ${CODEX_MODE}.`);
