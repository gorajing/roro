// scripts/smoke-floating-live-turn.mjs — real live turn smoke for floating Ask or the typed prompt.
//
// This is the live counterpart to smoke-floating-ask.mjs. It launches the real
// Electron renderer, drives the visible form, and lets the product bridge call
// window.companion.turnRun. By default it starts a tiny fake Ollama server for
// deterministic answer-turn coverage; set RORO_FLOATING_LIVE_USE_REAL_OLLAMA=1
// or RORO_LIVE_USE_REAL_OLLAMA=1 to use a real local daemon. It does NOT enable
// RORO_FLOATING_SMOKE, RORO_DEBUG_BRIDGE, runTask, or any direct brain/memory
// debug handle.

import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const PORT = process.env.RORO_DEBUG_PORT || String(await freePort());
const SURFACE = process.env.RORO_LIVE_SURFACE || 'floating';
if (!['floating', 'typed'].includes(SURFACE)) {
  throw new Error(`RORO_LIVE_SURFACE must be "floating" or "typed" (got ${JSON.stringify(SURFACE)})`);
}
const IS_TYPED = SURFACE === 'typed';
const BOOT_TIMEOUT_MS = Number(process.env.RORO_LIVE_BOOT_TIMEOUT_MS || process.env.RORO_FLOATING_LIVE_BOOT_TIMEOUT_MS || 180_000);
const TURN_TIMEOUT_MS = Number(process.env.RORO_LIVE_TURN_TIMEOUT_MS || process.env.RORO_FLOATING_LIVE_TURN_TIMEOUT_MS || 180_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_LIVE_CDP_TIMEOUT_MS || process.env.RORO_FLOATING_LIVE_CDP_TIMEOUT_MS || 60_000);
const USE_REAL_OLLAMA = (process.env.RORO_LIVE_USE_REAL_OLLAMA || process.env.RORO_FLOATING_LIVE_USE_REAL_OLLAMA) === '1';
const EXPECTED = 'roro live turn ok';
const STOP_TRANSCRIPT = IS_TYPED ? 'roro typed stop before executor ok' : 'roro stop before executor ok';
const ACTIVE_STOP_TRANSCRIPT = IS_TYPED ? 'roro typed active executor stop ok' : 'roro active executor stop ok';
const EXECUTOR_FILE = 'roro-floating-executor-smoke.txt';
const EXECUTOR_CONTENT = 'executor turn ok\n';
const ACTIVE_STOP_FILE = 'roro-active-stop-should-not-exist.txt';
const ACTIVE_STOP_CONTENT = 'active executor stop should not write this\n';

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
  if (chunks.length === 0) return {};
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
        const isActiveStopTurn = transcript.includes(ACTIVE_STOP_TRANSCRIPT);
        const isExecutorTurn = !isActiveStopTurn && transcript.includes(EXECUTOR_FILE);
        const isAnswerTurn = !isExecutorTurn && transcript.includes(EXPECTED);
        const isStoppedTurn = !isActiveStopTurn && !isExecutorTurn && !isAnswerTurn && transcript.includes(STOP_TRANSCRIPT);
        let decisionPayload;
        if (isStoppedTurn) {
          await sleep(3000);
          decisionPayload = {
            narration: 'On it. I will start the stopped smoke task.',
            command: 'run_agent',
            args: {
              task: 'This task should be stopped before the executor starts.',
              cwd: null,
            },
          };
        } else if (isActiveStopTurn) {
          decisionPayload = {
            narration: 'On it. I will start the active stop smoke task.',
            command: 'run_agent',
            args: {
              task: `Start creating ${ACTIVE_STOP_FILE} but wait before writing it so Stop can abort the active executor.`,
              cwd: null,
            },
          };
        } else if (isExecutorTurn) {
          decisionPayload = {
            narration: 'On it. I will create the smoke file.',
            command: 'run_agent',
            args: {
              task: `Create ${EXECUTOR_FILE} with exactly ${JSON.stringify(EXECUTOR_CONTENT)} as its contents.`,
              cwd: null,
            },
          };
        } else {
          decisionPayload = { narration: EXPECTED, command: 'answer', args: {} };
        }
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
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    host: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function writeFakeCodexBin(path, argsFile, activeStopMarkerFile) {
  await writeFile(path, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const cwdIndex = args.indexOf('-C');
const repo = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
const file = join(repo, ${JSON.stringify(EXECUTOR_FILE)});
const content = ${JSON.stringify(EXECUTOR_CONTENT)};
const activeStopFile = join(repo, ${JSON.stringify(ACTIVE_STOP_FILE)});
const activeStopContent = ${JSON.stringify(ACTIVE_STOP_CONTENT)};
const argsFile = ${JSON.stringify(argsFile)};
const activeStopMarkerFile = ${JSON.stringify(activeStopMarkerFile)};
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

  const prompt = args.at(-1) || '';
  const isActiveStop = prompt.includes(${JSON.stringify(ACTIVE_STOP_FILE)});
  if (isActiveStop) {
    const markStopped = () => {
      writeFileSync(activeStopMarkerFile, JSON.stringify({ signal: 'SIGTERM', args, repo, ts: Date.now() }, null, 2), 'utf8');
      process.exit(0);
    };
    process.on('SIGTERM', markStopped);
    emit({ type: 'thread.started', thread_id: 'fake-codex-active-stop-thread' });
    emit({ type: 'turn.started' });
    await sleep(100);
    emit({
      type: 'item.started',
      item: {
        id: 'fake-active-stop-file',
        type: 'file_change',
        changes: [{ path: activeStopFile, kind: 'add' }],
        status: 'in_progress',
      },
    });
    await sleep(30000);
    writeFileSync(activeStopFile, activeStopContent, 'utf8');
    emit({
      type: 'item.completed',
      item: {
        id: 'fake-active-stop-file',
        type: 'file_change',
        changes: [{ path: activeStopFile, kind: 'add' }],
        status: 'completed',
      },
    });
    emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
    return;
  }

  emit({ type: 'thread.started', thread_id: 'fake-codex-thread' });
  emit({ type: 'turn.started' });
  await sleep(100);
  emit({
    type: 'item.started',
    item: {
      id: 'fake-file',
      type: 'file_change',
      changes: [{ path: file, kind: 'add' }],
      status: 'in_progress',
    },
  });
  writeFileSync(file, content, 'utf8');
  await sleep(1000);
  emit({
    type: 'item.completed',
    item: {
      id: 'fake-file',
      type: 'file_change',
      changes: [{ path: file, kind: 'add' }],
      status: 'completed',
    },
  });
  emit({
    type: 'item.completed',
    item: {
      id: 'fake-message',
      type: 'agent_message',
      text: 'Created the floating executor smoke file.',
      status: 'completed',
    },
  });
  emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
})().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
`, 'utf8');
  await chmod(path, 0o755);
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

async function stopProcessGroup(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
  if (await waitForChildExit(child, 5000)) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  await waitForChildExit(child, 2000);
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

async function waitForRendererTarget(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app exited before renderer CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${PORT}/json`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // port not up yet
    }
    await sleep(500);
  }
  throw new Error(`renderer CDP target never appeared on port ${PORT}`);
}

async function browserDebuggerUrl() {
  const version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
  if (typeof version.webSocketDebuggerUrl !== 'string') {
    throw new Error(`browser CDP target missing from /json/version on port ${PORT}`);
  }
  return version.webSocketDebuggerUrl;
}

function cdpClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timer);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
  });
  const send = (method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
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
  if (result.exceptionDetails) throw new Error(`${label}: eval failed: ${result.exceptionDetails.text}`);
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

const root = await mkdtemp(join(tmpdir(), IS_TYPED ? 'roro-typed-live-turn-' : 'roro-floating-live-turn-'));
const appCwd = process.cwd();
const projectDir = process.env.RORO_LIVE_WORKDIR || process.env.RORO_FLOATING_LIVE_WORKDIR || join(root, 'project');
const dbDir = join(root, 'memory');
const fakeCodexBin = join(root, 'fake-codex');
const fakeCodexArgsFile = join(root, 'fake-codex-args.json');
const fakeCodexActiveStopMarkerFile = join(root, 'fake-codex-active-stop-sigterm.json');
await mkdir(projectDir, { recursive: true });
await writeFakeCodexBin(fakeCodexBin, fakeCodexArgsFile, fakeCodexActiveStopMarkerFile);
const fakeOllama = USE_REAL_OLLAMA ? null : await startFakeOllama();
const appEnv = stripV0DeferredEnv({
  ...process.env,
  BRAIN_PROVIDER: 'ollama',
  ...(fakeOllama ? { OLLAMA_HOST: fakeOllama.host, OLLAMA_TIMEOUT_MS: '5000' } : {}),
  RORO_DEBUG_PORT: PORT,
  RORO_FLOATING_WINDOW: IS_TYPED ? '0' : '1',
  RORO_WORKDIR: projectDir,
  RORO_DB_DIR: dbDir,
  RORO_CODEX_BIN: fakeCodexBin,
});

const child = spawn('npm', ['start'], {
  cwd: appCwd,
  env: appEnv,
  stdio: 'inherit',
  detached: true,
});

let cdp;
let browserCdp;
try {
  console.log(
    `[smoke] launching ${SURFACE} app for a real turn ` +
      `(RORO_DEBUG_PORT=${PORT}, Ollama=${fakeOllama ? fakeOllama.host : 'real daemon'})...`,
  );
  const target = await waitForRendererTarget(child);
  browserCdp = cdpClient(await browserDebuggerUrl());
  await browserCdp.ready;
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  if (IS_TYPED) {
    await waitFor(
      cdp,
      `!!document.getElementById('prompt-form') && !document.body?.classList.contains('floating-window')`,
      BOOT_TIMEOUT_MS,
      'typed prompt mount',
    );

    const bridge = await evaluate(cdp, `(() => ({
      turnRun: typeof window.companion?.turnRun,
      cancelTask: typeof window.companion?.cancelTask,
      onActionEvent: typeof window.companion?.onActionEvent,
      onRunEnd: typeof window.companion?.onRunEnd,
      getBootstrapStatus: typeof window.companion?.getBootstrapStatus,
      getWorkdirConfig: typeof window.companion?.getWorkdirConfig,
      runTask: typeof window.companion?.runTask,
      smokeHook: typeof window.__roroFloatingAskSmoke,
      brainDecide: typeof window.brain?.decide,
      memoryRemember: typeof window.memory?.remember,
    }))()`, {}, 'bridge exposure check');
    check('public turnRun bridge exists', bridge.turnRun === 'function', JSON.stringify(bridge));
    check('public cancelTask bridge exists', bridge.cancelTask === 'function', JSON.stringify(bridge));
    check('public action-event bridge exists', bridge.onActionEvent === 'function', JSON.stringify(bridge));
    check('public runEnd bridge exists', bridge.onRunEnd === 'function', JSON.stringify(bridge));
    check('public bootstrap status bridge exists', bridge.getBootstrapStatus === 'function', JSON.stringify(bridge));
    check('public workdir config bridge exists', bridge.getWorkdirConfig === 'function', JSON.stringify(bridge));
    check('direct runTask debug bridge is absent', bridge.runTask === 'undefined', JSON.stringify(bridge));
    check('floating smoke harness is absent', bridge.smokeHook === 'undefined', JSON.stringify(bridge));
    check('direct brain decide bridge is absent', bridge.brainDecide === 'undefined', JSON.stringify(bridge));
    check('direct memory remember bridge is absent', bridge.memoryRemember === 'undefined', JSON.stringify(bridge));

    const initialDom = await evaluate(cdp, `(() => {
      const visible = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
          rect.width > 0 && rect.height > 0;
      };
      return {
        bodyFloating: document.body?.classList.contains('floating-window') ?? false,
        htmlFloating: document.documentElement?.classList.contains('floating-window') ?? false,
        overlayVisible: visible('#overlay'),
        formVisible: visible('#prompt-form'),
        inputVisible: visible('#prompt-input'),
        sendVisible: visible('#send-btn'),
        cancelVisible: visible('#cancel-btn'),
        floatingAskVisible: visible('#floating-ask'),
        floatingStopVisible: visible('#floating-stop'),
        placeholder: document.getElementById('prompt-input')?.getAttribute('placeholder') ?? '',
        sendDisabled: document.getElementById('send-btn')?.disabled ?? null,
        cancelDisabled: document.getElementById('cancel-btn')?.disabled ?? null,
        cancelText: document.getElementById('cancel-btn')?.textContent ?? '',
      };
    })()`, {}, 'typed initial DOM check');
    check('typed renderer is the default full-window surface', initialDom.bodyFloating === false && initialDom.htmlFloating === false, JSON.stringify(initialDom));
    check('typed prompt form is visibly rendered', initialDom.overlayVisible && initialDom.formVisible && initialDom.inputVisible && initialDom.sendVisible && initialDom.cancelVisible, JSON.stringify(initialDom));
    check('floating Ask controls are not visible in default window', initialDom.floatingAskVisible === false && initialDom.floatingStopVisible === false, JSON.stringify(initialDom));
    check('typed prompt starts ready with Stop disabled', initialDom.sendDisabled === false && initialDom.cancelDisabled === true && initialDom.cancelText === 'Stop', JSON.stringify(initialDom));
    check('typed prompt placeholder is product-facing', /ask roro to work/i.test(initialDom.placeholder), JSON.stringify(initialDom));

    const bootstrap = await waitFor(
      cdp,
      `window.companion.getBootstrapStatus()
        .then((status) => status?.ready ? ({ ok: true, status }) : false)
        .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
      BOOT_TIMEOUT_MS,
      'local brain readiness',
      { awaitPromise: true },
    );
    check('local Ollama brain is ready', bootstrap.ok === true, bootstrap.message || JSON.stringify(bootstrap.status));

    const workdirConfig = await evaluate(
      cdp,
      `window.companion.getWorkdirConfig()
        .then((config) => ({ ok: true, config }))
        .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
      { awaitPromise: true },
      'workdir config check',
    );
    check(
      'workdir gate sees a configured repo before submit',
      workdirConfig.ok === true && workdirConfig.config?.workdir === projectDir,
      workdirConfig.message || JSON.stringify(workdirConfig.config),
    );

    const memoryProfile = await evaluate(
      cdp,
      `window.memory.profile()
        .then((facts) => ({ ok: true, count: Array.isArray(facts) ? facts.length : null }))
        .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
      { awaitPromise: true },
      'memory profile warmup',
    );
    check(
      'memory profile bridge responds before submit',
      memoryProfile.ok === true,
      memoryProfile.message || JSON.stringify(memoryProfile),
    );

    await evaluate(cdp, `(() => {
      window.__roroTypedLiveTurn = { events: [], runEnds: [] };
      window.companion.onActionEvent((event) => window.__roroTypedLiveTurn.events.push(event));
      window.companion.onRunEnd((runEnd) => window.__roroTypedLiveTurn.runEnds.push(runEnd));
      return true;
    })()`, {}, 'stream probe install');

    const stoppedTranscript = `${STOP_TRANSCRIPT}. Start a coding task that should be stopped before the executor starts.`;
    const eventCountBeforeStopped = await evaluate(
      cdp,
      `window.__roroTypedLiveTurn?.events?.length ?? 0`,
      {},
      'event count before stopped turn',
    );
    const stoppedSubmit = await evaluate(cdp, `(() => {
      const input = document.getElementById('prompt-input');
      const form = document.getElementById('prompt-form');
      input.value = ${JSON.stringify(stoppedTranscript)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { defaultPrevented: !notCanceled, value: input.value };
    })()`, {}, 'typed stopped form submit');
    check('typed form submit listener prevents native navigation', stoppedSubmit.defaultPrevented === true, JSON.stringify(stoppedSubmit));

    const accepted = await waitFor(
      cdp,
      `(() => {
        const input = document.getElementById('prompt-input');
        const send = document.getElementById('send-btn');
        const cancel = document.getElementById('cancel-btn');
        const status = document.getElementById('status');
        const caption = document.getElementById('caption-final');
        const events = window.__roroTypedLiveTurn?.events?.slice(${JSON.stringify(eventCountBeforeStopped)}) ?? [];
        if (!send?.disabled || cancel?.disabled) return false;
        return {
          inputValue: input?.value ?? '',
          sendDisabled: send.disabled,
          cancelDisabled: cancel.disabled,
          cancelText: cancel.textContent,
          statusText: status?.textContent ?? '',
          captionText: caption?.textContent ?? '',
          sawRunStarted: events.some((event) => event?.kind === 'run.started'),
        };
      })()`,
      10_000,
      'typed accepted state before run.started',
    );
    check('typed input keeps submitted task visible while in flight', accepted.inputValue.includes(STOP_TRANSCRIPT), JSON.stringify(accepted));
    check('typed Stop arms immediately before run.started', accepted.cancelDisabled === false && accepted.cancelText === 'Stop' && accepted.sawRunStarted === false, JSON.stringify(accepted));
    check('typed status names the immediate Stop affordance', /Thinking\.\.\. click Stop/.test(accepted.statusText), JSON.stringify(accepted));
    check('typed caption records the submitted task', accepted.captionText.includes(`You: ${stoppedTranscript}`), JSON.stringify(accepted));

    await waitFor(
      cdp,
      `(() => {
        const events = window.__roroTypedLiveTurn?.events?.slice(${JSON.stringify(eventCountBeforeStopped)}) ?? [];
        return events.some((event) => event?.kind === 'message' && event.text?.includes('planning')) &&
          !events.some((event) => event?.kind === 'run.started');
      })()`,
      10_000,
      'typed stopped turn entered main planning before Stop',
    );
    await evaluate(cdp, `document.getElementById('cancel-btn').click()`, {}, 'typed Stop click');
    const stopFeedback = await evaluate(cdp, `(() => ({
      cancelText: document.getElementById('cancel-btn')?.textContent ?? '',
      statusText: document.getElementById('status')?.textContent ?? '',
      cancelWidth: document.getElementById('cancel-btn')?.getBoundingClientRect()?.width ?? 0,
    }))()`, {}, 'typed Stop feedback check');
    check('typed Stop shows Stopping feedback before run.started', stopFeedback.cancelText === 'Stopping...' && stopFeedback.statusText === 'Stopping...', JSON.stringify(stopFeedback));
    check('typed Stopping label fits the stable Stop button width', stopFeedback.cancelWidth >= 96, JSON.stringify(stopFeedback));

    const stoppedTurn = await waitFor(
      cdp,
      `(() => {
        const probe = window.__roroTypedLiveTurn;
        if (!probe?.runEnds?.length) return false;
        const runEnd = probe.runEnds[probe.runEnds.length - 1];
        const events = probe.events.filter((event) => event?.runId === runEnd.runId);
        return { runEnd, events, allEvents: probe.events };
      })()`,
      TURN_TIMEOUT_MS,
      'typed stopped turn runEnd',
    );
    const stoppedEvents = Array.isArray(stoppedTurn.events) ? stoppedTurn.events : [];
    check('typed stopped turn produced scoped events', stoppedEvents.length > 0, JSON.stringify(stoppedTurn.allEvents ?? []));
    check('typed stopped turn emitted run.failed stopped', stoppedEvents.some((event) => event?.kind === 'run.failed' && event.error === 'stopped'), JSON.stringify(stoppedEvents));
    check('typed stopped turn never emitted run.started', !stoppedEvents.some((event) => event?.kind === 'run.started'), JSON.stringify(stoppedEvents));
    check('typed stopped turn never emitted run.completed', !stoppedEvents.some((event) => event?.kind === 'run.completed'), JSON.stringify(stoppedEvents));
    check('typed stopped turn emitted no executor side effects', !stoppedEvents.some((event) => ['file_change', 'command', 'tool'].includes(event?.kind)), JSON.stringify(stoppedEvents));
    const invocationsAfterStopped = await readFile(fakeCodexArgsFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => []);
    check('typed stopped turn did not launch fake Codex', Array.isArray(invocationsAfterStopped) && invocationsAfterStopped.length === 0, JSON.stringify(invocationsAfterStopped));

    const stoppedUi = await waitFor(
      cdp,
      `(() => {
        const input = document.getElementById('prompt-input');
        const send = document.getElementById('send-btn');
        const cancel = document.getElementById('cancel-btn');
        const status = document.getElementById('status');
        if (send?.disabled || !cancel?.disabled || cancel?.textContent !== 'Stop' || input?.value !== '') return false;
        return { statusText: status?.textContent ?? '', sendDisabled: send.disabled, cancelDisabled: cancel.disabled, cancelText: cancel.textContent, inputValue: input.value };
      })()`,
      5000,
      'typed stopped UI release',
    );
    check('typed stopped copy is neutral', stoppedUi.statusText === 'Stopped.', JSON.stringify(stoppedUi));
    check('typed stopped copy is not a task problem', !stoppedUi.statusText.includes('Task hit a problem'), JSON.stringify(stoppedUi));
    const stoppedVisibleCopy = await evaluate(cdp, `(() => ({
      captionText: document.getElementById('caption-final')?.textContent ?? '',
      timelineText: document.getElementById('timeline')?.textContent ?? '',
    }))()`, {}, 'typed stopped caption/timeline check');
    check('typed stopped caption releases planning copy', stoppedVisibleCopy.captionText === 'Roro: Stopped.', JSON.stringify(stoppedVisibleCopy));
    check('typed stopped timeline is neutral', stoppedVisibleCopy.timelineText.includes('Run stopped') && !stoppedVisibleCopy.timelineText.includes('Run needs attention'), JSON.stringify(stoppedVisibleCopy));

    const activeStopTranscript = `${ACTIVE_STOP_TRANSCRIPT}. Start a coding task, wait until it has started, then Stop should abort the active executor.`;
    const runEndCountBeforeActiveStop = await evaluate(
      cdp,
      `window.__roroTypedLiveTurn?.runEnds?.length ?? 0`,
      {},
      'runEnd count before typed active-stop turn',
    );
    const activeStopSubmit = await evaluate(cdp, `(() => {
      const input = document.getElementById('prompt-input');
      const form = document.getElementById('prompt-form');
      input.value = ${JSON.stringify(activeStopTranscript)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { defaultPrevented: !notCanceled, value: input.value };
    })()`, {}, 'typed active-stop form submit');
    check('typed active-stop submit listener prevents native navigation', activeStopSubmit.defaultPrevented === true, JSON.stringify(activeStopSubmit));

    const activeStopStarted = await waitFor(
      cdp,
      `(() => {
        const events = window.__roroTypedLiveTurn?.events ?? [];
        const runStarted = events.find((event) =>
          event?.kind === 'run.started' &&
          event.threadId === 'fake-codex-active-stop-thread');
        if (!runStarted) return false;
        const scoped = events.filter((event) => event?.runId === runStarted.runId);
        const startedFile = scoped.some((event) =>
          event?.kind === 'file_change' &&
          event.status === 'started' &&
          event.files?.some((file) => file.path?.endsWith(${JSON.stringify(ACTIVE_STOP_FILE)})));
        if (!startedFile) return false;
        return {
          runId: runStarted.runId,
          agent: runStarted.agent,
          threadId: runStarted.threadId,
          events: scoped,
          cancelText: document.getElementById('cancel-btn')?.textContent ?? '',
          cancelDisabled: document.getElementById('cancel-btn')?.disabled ?? null,
          statusText: document.getElementById('status')?.textContent ?? '',
        };
      })()`,
      10_000,
      'typed active-stop run.started + file_change started',
    );
    check('typed active-stop turn emitted run.started from fake Codex', activeStopStarted.agent === 'codex' && activeStopStarted.threadId === 'fake-codex-active-stop-thread', JSON.stringify(activeStopStarted));
    check('typed active-stop Stop is armed after run.started', activeStopStarted.cancelDisabled === false && activeStopStarted.cancelText === 'Stop' && /Working on it/.test(activeStopStarted.statusText), JSON.stringify(activeStopStarted));
    await evaluate(cdp, `document.getElementById('cancel-btn').click()`, {}, 'typed active-stop Stop click');
    const activeStopFeedback = await evaluate(cdp, `(() => ({
      cancelText: document.getElementById('cancel-btn')?.textContent ?? '',
      statusText: document.getElementById('status')?.textContent ?? '',
    }))()`, {}, 'typed active-stop feedback check');
    check('typed active-stop shows Stopping feedback after run.started', activeStopFeedback.cancelText === 'Stopping...' && activeStopFeedback.statusText === 'Stopping...', JSON.stringify(activeStopFeedback));

    const activeStopTurn = await waitFor(
      cdp,
      `(() => {
        const probe = window.__roroTypedLiveTurn;
        const runId = ${JSON.stringify(activeStopStarted.runId)};
        const runEnd = probe?.runEnds?.find((end) => end?.runId === runId);
        if (!runEnd || (probe?.runEnds?.length ?? 0) <= ${JSON.stringify(runEndCountBeforeActiveStop)}) return false;
        const events = probe.events.filter((event) => event?.runId === runId);
        return { runEnd, events, allEvents: probe.events };
      })()`,
      TURN_TIMEOUT_MS,
      'typed active-stop turn runEnd',
    );
    const activeStopEvents = Array.isArray(activeStopTurn.events) ? activeStopTurn.events : [];
    const activeStopFileEvents = activeStopEvents.filter((event) => event?.kind === 'file_change' && event.files?.some((file) => file.path?.endsWith(ACTIVE_STOP_FILE)));
    check('typed active-stop produced scoped events', activeStopEvents.length > 0, JSON.stringify(activeStopTurn.allEvents ?? []));
    check('typed active-stop emitted exactly one run.started', activeStopEvents.filter((event) => event?.kind === 'run.started').length === 1, JSON.stringify(activeStopEvents));
    check('typed active-stop emitted run.failed aborted', activeStopEvents.some((event) => event?.kind === 'run.failed' && event.error === 'aborted'), JSON.stringify(activeStopEvents));
    check('typed active-stop never emitted run.completed', !activeStopEvents.some((event) => event?.kind === 'run.completed'), JSON.stringify(activeStopEvents));
    check('typed active-stop never completed the file_change', !activeStopFileEvents.some((event) => event.status === 'completed'), JSON.stringify(activeStopEvents));
    const typedActiveStopMarker = await readFile(fakeCodexActiveStopMarkerFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null);
    check('typed active-stop fake Codex recorded SIGTERM', typedActiveStopMarker?.signal === 'SIGTERM', JSON.stringify(typedActiveStopMarker));
    check(
      'typed active-stop fake Codex did not write the aborted file',
      await readFile(join(projectDir, ACTIVE_STOP_FILE), 'utf8').then(() => false).catch(() => true),
    );
    const typedActiveStopInvocations = await readFile(fakeCodexArgsFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => []);
    const expectedCodexPrefix = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', projectDir];
    const typedActiveStopArgs = Array.isArray(typedActiveStopInvocations)
      ? typedActiveStopInvocations.map((invocation) => invocation?.args).filter(Array.isArray)
      : [];
    check(
      'typed active-stop fake Codex received the executor CLI shape',
      typedActiveStopArgs.some((args) =>
        JSON.stringify(args.slice(0, expectedCodexPrefix.length)) === JSON.stringify(expectedCodexPrefix) &&
        args.at(-1)?.includes(ACTIVE_STOP_FILE)),
      JSON.stringify(typedActiveStopInvocations),
    );
    const activeStoppedUi = await waitFor(
      cdp,
      `(() => {
        const input = document.getElementById('prompt-input');
        const send = document.getElementById('send-btn');
        const cancel = document.getElementById('cancel-btn');
        const status = document.getElementById('status');
        if (send?.disabled || !cancel?.disabled || cancel?.textContent !== 'Stop' || input?.value !== '') return false;
        return { statusText: status?.textContent ?? '', sendDisabled: send.disabled, cancelDisabled: cancel.disabled, cancelText: cancel.textContent, inputValue: input.value };
      })()`,
      5000,
      'typed active-stop UI release',
    );
    check('typed active-stop stopped copy is neutral', activeStoppedUi.statusText === 'Stopped.', JSON.stringify(activeStoppedUi));
    check('typed active-stop stopped copy is not a task problem', !activeStoppedUi.statusText.includes('Task hit a problem'), JSON.stringify(activeStoppedUi));
    const activeStoppedVisibleCopy = await evaluate(cdp, `(() => ({
      captionText: document.getElementById('caption-final')?.textContent ?? '',
      timelineText: document.getElementById('timeline')?.textContent ?? '',
    }))()`, {}, 'typed active-stop caption/timeline check');
    check('typed active-stop caption releases planning copy', activeStoppedVisibleCopy.captionText === 'Roro: Stopped.', JSON.stringify(activeStoppedVisibleCopy));
    check('typed active-stop timeline is neutral', activeStoppedVisibleCopy.timelineText.includes('Run stopped') && !activeStoppedVisibleCopy.timelineText.includes('Run needs attention') && !activeStoppedVisibleCopy.timelineText.includes('aborted'), JSON.stringify(activeStoppedVisibleCopy));

    const answerTranscript = `${EXPECTED}. Answer with exactly that phrase and no extra words.`;
    const runEndCountBeforeAnswer = await evaluate(
      cdp,
      `window.__roroTypedLiveTurn?.runEnds?.length ?? 0`,
      {},
      'runEnd count before typed recovery turn',
    );
    const answerSubmit = await evaluate(cdp, `(() => {
      const input = document.getElementById('prompt-input');
      const form = document.getElementById('prompt-form');
      input.value = ${JSON.stringify(answerTranscript)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { defaultPrevented: !notCanceled, value: input.value };
    })()`, {}, 'typed answer form submit');
    check('typed form recovers after stopped turn and accepts another submit', answerSubmit.defaultPrevented === true, JSON.stringify(answerSubmit));

    const answerTurn = await waitFor(
      cdp,
      `(() => {
        const probe = window.__roroTypedLiveTurn;
        if ((probe?.runEnds?.length ?? 0) <= ${JSON.stringify(runEndCountBeforeAnswer)}) return false;
        const runEnd = probe.runEnds[probe.runEnds.length - 1];
        const events = probe.events.filter((event) => event?.runId === runEnd.runId);
        return { runEnd, events, allEvents: probe.events };
      })()`,
      TURN_TIMEOUT_MS,
      'typed answer turn runEnd',
    );
    const answerEvents = Array.isArray(answerTurn.events) ? answerTurn.events : [];
    const narration = answerEvents
      .filter((event) => event?.kind === 'message')
      .map((event) => event.text)
      .join('\n');
    check('typed answer turn produced scoped events', answerEvents.length > 0, JSON.stringify(answerTurn.allEvents ?? []));
    check('typed answer turn did not start the coding executor', !answerEvents.some((event) => event?.kind === 'run.started'), JSON.stringify(answerEvents));
    check('typed answer turn produced no run.failed event', !answerEvents.some((event) => event?.kind === 'run.failed'), JSON.stringify(answerEvents));
    check('typed answer turn narration includes requested phrase', narration.toLowerCase().includes(EXPECTED), narration.slice(0, 500));
    const recoveredUi = await waitFor(
      cdp,
      `(() => {
        const input = document.getElementById('prompt-input');
        const send = document.getElementById('send-btn');
        const cancel = document.getElementById('cancel-btn');
        const status = document.getElementById('status');
        if (send?.disabled || !cancel?.disabled || input?.value !== '') return false;
        return { statusText: status?.textContent ?? '', cancelText: cancel?.textContent ?? '' };
      })()`,
      5000,
      'typed answer UI release',
    );
    check('typed form returns to ready state after recovery turn', recoveredUi.statusText.includes('Done') && recoveredUi.cancelText === 'Stop', JSON.stringify(recoveredUi));
  } else {
  await waitFor(
    cdp,
    `document.body?.classList.contains('floating-window') && !!document.getElementById('floating-ask')`,
    BOOT_TIMEOUT_MS,
    'floating Ask mount',
  );

  const bridge = await evaluate(cdp, `(() => ({
    turnRun: typeof window.companion?.turnRun,
    onActionEvent: typeof window.companion?.onActionEvent,
    onRunEnd: typeof window.companion?.onRunEnd,
    runTask: typeof window.companion?.runTask,
    smokeHook: typeof window.__roroFloatingAskSmoke,
    brainDecide: typeof window.brain?.decide,
    memoryRemember: typeof window.memory?.remember,
  }))()`, {}, 'bridge exposure check');
  check('public turnRun bridge exists', bridge.turnRun === 'function', JSON.stringify(bridge));
  check('public action-event bridge exists', bridge.onActionEvent === 'function', JSON.stringify(bridge));
  check('public runEnd bridge exists', bridge.onRunEnd === 'function', JSON.stringify(bridge));
  check('direct runTask debug bridge is absent', bridge.runTask === 'undefined', JSON.stringify(bridge));
  check('floating smoke harness is absent', bridge.smokeHook === 'undefined', JSON.stringify(bridge));
  check('direct brain decide bridge is absent', bridge.brainDecide === 'undefined', JSON.stringify(bridge));
  check('direct memory remember bridge is absent', bridge.memoryRemember === 'undefined', JSON.stringify(bridge));

  const bootstrap = await waitFor(
    cdp,
    `window.companion.getBootstrapStatus()
      .then((status) => status?.ready ? ({ ok: true, status }) : false)
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    BOOT_TIMEOUT_MS,
    'local brain readiness',
    { awaitPromise: true },
  );
  check('local Ollama brain is ready', bootstrap.ok === true, bootstrap.message || JSON.stringify(bootstrap.status));

  const workdirConfig = await evaluate(
    cdp,
    `window.companion.getWorkdirConfig()
      .then((config) => ({ ok: true, config }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'workdir config check',
  );
  check(
    'workdir gate sees a configured repo before submit',
    workdirConfig.ok === true && workdirConfig.config?.workdir === projectDir,
    workdirConfig.message || JSON.stringify(workdirConfig.config),
  );

  const memoryProfile = await evaluate(
    cdp,
    `window.memory.profile()
      .then((facts) => ({ ok: true, count: Array.isArray(facts) ? facts.length : null }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'memory profile warmup',
  );
  check(
    'memory profile bridge responds before submit',
    memoryProfile.ok === true,
    memoryProfile.message || JSON.stringify(memoryProfile),
  );

  await evaluate(cdp, `(() => {
    window.__roroFloatingLiveTurn = { events: [], runEnds: [] };
    window.companion.onActionEvent((event) => window.__roroFloatingLiveTurn.events.push(event));
    window.companion.onRunEnd((runEnd) => window.__roroFloatingLiveTurn.runEnds.push(runEnd));
    return true;
  })()`, {}, 'stream probe install');

  const transcript = `${EXPECTED}. Answer with exactly that phrase and no extra words.`;
  await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'Ask pill click');
  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('expanded')`,
    5000,
    'Ask expansion',
  );
  const submitResult = await evaluate(cdp, `(() => {
    const input = document.getElementById('ask-input');
    const form = document.getElementById('floating-ask');
    input.value = ${JSON.stringify(transcript)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { defaultPrevented: !notCanceled, value: input.value };
  })()`, {}, 'Ask form submit');
  check('Ask form submit listener prevents native navigation', submitResult.defaultPrevented === true, JSON.stringify(submitResult));
  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('tasked')`,
    5000,
    'Ask tasked state',
  );
  check(
    'Ask pill shows the real submitted task',
    await evaluate(cdp, `document.getElementById('ask-pill')?.textContent?.includes(${JSON.stringify(EXPECTED)})`, {}, 'Ask tasked text check'),
  );

  const turn = await waitFor(
    cdp,
    `(() => {
      const probe = window.__roroFloatingLiveTurn;
      if (!probe?.runEnds?.length) return false;
      const runEnd = probe.runEnds[0];
      const events = probe.events.filter((event) => event?.runId === runEnd.runId);
      return { runEnd, events, allEvents: probe.events };
    })()`,
    TURN_TIMEOUT_MS,
    'real turn runEnd',
  );
  const events = Array.isArray(turn.events) ? turn.events : [];
  const narration = events
    .filter((event) => event?.kind === 'message')
    .map((event) => event.text)
    .join('\n');
  const memoryStatus = events.find((event) => event?.kind === 'status' && /^Memory:/.test(event.text ?? ''));

  check('real turn produced scoped events', events.length > 0, JSON.stringify(turn.allEvents ?? []));
  check('real turn emitted a memory status beat', Boolean(memoryStatus), JSON.stringify(events));
  check('real turn did not start the coding executor', !events.some((event) => event?.kind === 'run.started'), JSON.stringify(events));
  check('real turn produced no run.failed event', !events.some((event) => event?.kind === 'run.failed'), JSON.stringify(events));
  check('real turn narration includes requested phrase', narration.toLowerCase().includes(EXPECTED), narration.slice(0, 500));

  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
    5000,
    'Ask collapse after runEnd',
  );
  check('floating Ask is collapsed after real runEnd', await evaluate(cdp, `document.getElementById('floating-ask')?.classList.contains('collapsed')`, {}, 'Ask collapse check'));
  check('floating Stop remains hidden for answer turn', await evaluate(cdp, `!document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'Stop hidden check'));
  const answerReceipt = await evaluate(cdp, `(() => {
    const el = document.getElementById('floating-error');
    return { hidden: el?.hidden, text: el?.textContent ?? '', success: el?.classList.contains('success') ?? false };
  })()`, {}, 'answer receipt check');
  check('floating receipt is visible for successful answer turn', answerReceipt.hidden === false, JSON.stringify(answerReceipt));
  check('floating receipt has success tone for answer turn', answerReceipt.success === true, JSON.stringify(answerReceipt));
  check('floating receipt reports memory result for answer turn', /^Done\. Memory (used|checked)\.$/.test(answerReceipt.text), JSON.stringify(answerReceipt));

  if (!USE_REAL_OLLAMA) {
    const stoppedTranscript = `${STOP_TRANSCRIPT}. Start a coding task that should be stopped before the executor starts.`;
    const eventCountBeforeStopped = await evaluate(
      cdp,
      `window.__roroFloatingLiveTurn?.events?.length ?? 0`,
      {},
      'event count before stopped turn',
    );
    await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'stopped Ask pill click');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('expanded')`,
      5000,
      'stopped Ask expansion',
    );
    const stoppedSubmit = await evaluate(cdp, `(() => {
      const input = document.getElementById('ask-input');
      const form = document.getElementById('floating-ask');
      input.value = ${JSON.stringify(stoppedTranscript)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { defaultPrevented: !notCanceled, value: input.value };
    })()`, {}, 'stopped Ask form submit');
    check('stopped Ask form submit listener prevents native navigation', stoppedSubmit.defaultPrevented === true, JSON.stringify(stoppedSubmit));
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('tasked')`,
      5000,
      'stopped Ask tasked state',
    );
    check(
      'stopped Ask pill shows the submitted task',
      await evaluate(cdp, `document.getElementById('ask-pill')?.textContent?.includes(${JSON.stringify(STOP_TRANSCRIPT)})`, {}, 'stopped tasked text check'),
    );
    check('floating Stop arms immediately for accepted stopped turn', await evaluate(cdp, `document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'stopped Stop armed check'));
    await waitFor(
      cdp,
      `window.__roroFloatingLiveTurn?.events?.slice(${JSON.stringify(eventCountBeforeStopped)})
        .some((event) => event?.kind === 'message' && event.text?.includes('planning'))`,
      10_000,
      'stopped turn entered main planning before Stop',
    );
    await evaluate(cdp, `document.getElementById('floating-stop').click()`, {}, 'stopped Stop click');
    check('floating Stop shows Stopping feedback before run.started', await evaluate(cdp, `document.getElementById('floating-stop')?.textContent === 'Stopping...'`, {}, 'stopped Stop feedback check'));

    const stoppedTurn = await waitFor(
      cdp,
      `(() => {
        const probe = window.__roroFloatingLiveTurn;
        if ((probe?.runEnds?.length ?? 0) < 2) return false;
        const runEnd = probe.runEnds[probe.runEnds.length - 1];
        const events = probe.events.filter((event) => event?.runId === runEnd.runId);
        return { runEnd, events, allEvents: probe.events };
      })()`,
      TURN_TIMEOUT_MS,
      'stopped turn runEnd',
    );
    const stoppedEvents = Array.isArray(stoppedTurn.events) ? stoppedTurn.events : [];
    check('stopped turn produced scoped events', stoppedEvents.length > 0, JSON.stringify(stoppedTurn.allEvents ?? []));
    check('stopped turn emitted run.failed stopped', stoppedEvents.some((event) => event?.kind === 'run.failed' && event.error === 'stopped'), JSON.stringify(stoppedEvents));
    check('stopped turn never emitted run.started', !stoppedEvents.some((event) => event?.kind === 'run.started'), JSON.stringify(stoppedEvents));
    const invocationsAfterStopped = await readFile(fakeCodexArgsFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => []);
    check('stopped turn did not launch fake Codex', Array.isArray(invocationsAfterStopped) && invocationsAfterStopped.length === 0, JSON.stringify(invocationsAfterStopped));
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
      5000,
      'stopped Ask collapse after runEnd',
    );
    check('floating Ask is collapsed after stopped runEnd', await evaluate(cdp, `document.getElementById('floating-ask')?.classList.contains('collapsed')`, {}, 'stopped Ask collapse check'));
    check('floating Stop disarms after stopped turn', await evaluate(cdp, `!document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'stopped Stop disarmed check'));
    check('floating stopped copy is neutral', await evaluate(cdp, `document.getElementById('floating-error')?.textContent === 'Stopped.' && document.getElementById('floating-error')?.classList.contains('neutral')`, {}, 'stopped neutral copy check'));
    check('floating stopped copy is not a task problem', await evaluate(cdp, `!document.getElementById('floating-error')?.textContent?.includes('Task hit a problem')`, {}, 'stopped copy wording check'));
    await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'clear stopped notice Ask pill click');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('expanded') && document.getElementById('floating-error')?.hidden === true`,
      5000,
      'stopped notice cleared on next summon',
    );
    await evaluate(cdp, `document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`, {}, 'clear stopped notice Escape');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
      5000,
      'Ask collapse after clearing stopped notice',
    );

    const activeStopTranscript = `${ACTIVE_STOP_TRANSCRIPT}. Start a coding task, wait until it has started, then Stop should abort the active executor.`;
    const runEndCountBeforeActiveStop = await evaluate(
      cdp,
      `window.__roroFloatingLiveTurn?.runEnds?.length ?? 0`,
      {},
      'runEnd count before active-stop turn',
    );
    await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'active-stop Ask pill click');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('expanded')`,
      5000,
      'active-stop Ask expansion',
    );
    const activeStopSubmit = await evaluate(cdp, `(() => {
      const input = document.getElementById('ask-input');
      const form = document.getElementById('floating-ask');
      input.value = ${JSON.stringify(activeStopTranscript)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { defaultPrevented: !notCanceled, value: input.value };
    })()`, {}, 'active-stop Ask form submit');
    check('active-stop Ask form submit listener prevents native navigation', activeStopSubmit.defaultPrevented === true, JSON.stringify(activeStopSubmit));
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('tasked')`,
      5000,
      'active-stop Ask tasked state',
    );
    check(
      'active-stop Ask pill shows the submitted task',
      await evaluate(cdp, `document.getElementById('ask-pill')?.textContent?.includes(${JSON.stringify(ACTIVE_STOP_TRANSCRIPT)})`, {}, 'active-stop tasked text check'),
    );

    const activeStopStarted = await waitFor(
      cdp,
      `(() => {
        const events = window.__roroFloatingLiveTurn?.events ?? [];
        const runStarted = events.find((event) =>
          event?.kind === 'run.started' &&
          event.threadId === 'fake-codex-active-stop-thread');
        if (!runStarted) return false;
        const scoped = events.filter((event) => event?.runId === runStarted.runId);
        const startedFile = scoped.some((event) =>
          event?.kind === 'file_change' &&
          event.status === 'started' &&
          event.files?.some((file) => file.path?.endsWith(${JSON.stringify(ACTIVE_STOP_FILE)})));
        if (!startedFile) return false;
        const stop = document.getElementById('floating-stop');
        const stopRect = stop?.getBoundingClientRect();
        return {
          runId: runStarted.runId,
          agent: runStarted.agent,
          threadId: runStarted.threadId,
          stopText: stop?.textContent ?? '',
          stopArmed: stop?.classList.contains('armed') ?? false,
          stopVisible: !!stopRect && stopRect.width > 0 && stopRect.height > 0,
          events: scoped,
        };
      })()`,
      10_000,
      'active-stop run.started + file_change started',
    );
    check('active-stop turn emitted run.started from fake Codex', activeStopStarted.agent === 'codex' && activeStopStarted.threadId === 'fake-codex-active-stop-thread', JSON.stringify(activeStopStarted));
    check('floating Stop remains visible and armed after active run.started', activeStopStarted.stopArmed === true && activeStopStarted.stopVisible === true && activeStopStarted.stopText === 'Stop', JSON.stringify(activeStopStarted));
    await evaluate(cdp, `document.getElementById('floating-stop').click()`, {}, 'active-stop Stop click');
    check('floating active-stop shows Stopping feedback after run.started', await evaluate(cdp, `document.getElementById('floating-stop')?.textContent === 'Stopping...'`, {}, 'active-stop Stop feedback check'));

    const activeStopTurn = await waitFor(
      cdp,
      `(() => {
        const probe = window.__roroFloatingLiveTurn;
        const runId = ${JSON.stringify(activeStopStarted.runId)};
        const runEnd = probe?.runEnds?.find((end) => end?.runId === runId);
        if (!runEnd || (probe?.runEnds?.length ?? 0) <= ${JSON.stringify(runEndCountBeforeActiveStop)}) return false;
        const events = probe.events.filter((event) => event?.runId === runId);
        return { runEnd, events, allEvents: probe.events };
      })()`,
      TURN_TIMEOUT_MS,
      'active-stop turn runEnd',
    );
    const activeStopEvents = Array.isArray(activeStopTurn.events) ? activeStopTurn.events : [];
    const activeStopFileEvents = activeStopEvents.filter((event) => event?.kind === 'file_change' && event.files?.some((file) => file.path?.endsWith(ACTIVE_STOP_FILE)));
    check('active-stop turn produced scoped events', activeStopEvents.length > 0, JSON.stringify(activeStopTurn.allEvents ?? []));
    check('active-stop turn emitted exactly one run.started', activeStopEvents.filter((event) => event?.kind === 'run.started').length === 1, JSON.stringify(activeStopEvents));
    check('active-stop turn emitted run.failed aborted', activeStopEvents.some((event) => event?.kind === 'run.failed' && event.error === 'aborted'), JSON.stringify(activeStopEvents));
    check('active-stop turn never emitted run.completed', !activeStopEvents.some((event) => event?.kind === 'run.completed'), JSON.stringify(activeStopEvents));
    check('active-stop turn never completed the file_change', !activeStopFileEvents.some((event) => event.status === 'completed'), JSON.stringify(activeStopEvents));
    const activeStopMarker = await readFile(fakeCodexActiveStopMarkerFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null);
    check('active-stop fake Codex recorded SIGTERM', activeStopMarker?.signal === 'SIGTERM', JSON.stringify(activeStopMarker));
    check(
      'active-stop fake Codex did not write the aborted file',
      await readFile(join(projectDir, ACTIVE_STOP_FILE), 'utf8').then(() => false).catch(() => true),
    );
    const activeStopInvocations = await readFile(fakeCodexArgsFile, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => []);
    const activeExpectedCodexPrefix = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', projectDir];
    const activeStopArgs = Array.isArray(activeStopInvocations)
      ? activeStopInvocations.map((invocation) => invocation?.args).filter(Array.isArray)
      : [];
    check(
      'active-stop fake Codex received the executor CLI shape',
      activeStopArgs.some((args) =>
        JSON.stringify(args.slice(0, activeExpectedCodexPrefix.length)) === JSON.stringify(activeExpectedCodexPrefix) &&
        args.at(-1)?.includes(ACTIVE_STOP_FILE)),
      JSON.stringify(activeStopInvocations),
    );
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
      5000,
      'active-stop Ask collapse after runEnd',
    );
    check('floating Ask is collapsed after active-stop runEnd', await evaluate(cdp, `document.getElementById('floating-ask')?.classList.contains('collapsed')`, {}, 'active-stop Ask collapse check'));
    check('floating Stop disarms after active-stop turn', await evaluate(cdp, `!document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'active-stop Stop disarmed check'));
    check('floating active-stop copy is neutral', await evaluate(cdp, `document.getElementById('floating-error')?.textContent === 'Stopped.' && document.getElementById('floating-error')?.classList.contains('neutral')`, {}, 'active-stop neutral copy check'));
    check('floating active-stop copy is not a task problem', await evaluate(cdp, `!document.getElementById('floating-error')?.textContent?.includes('Task hit a problem')`, {}, 'active-stop copy wording check'));
    await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'clear active-stop notice Ask pill click');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('expanded') && document.getElementById('floating-error')?.hidden === true`,
      5000,
      'active-stop notice cleared on next summon',
    );
    await evaluate(cdp, `document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`, {}, 'clear active-stop notice Escape');
    await waitFor(
      cdp,
      `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
      5000,
      'Ask collapse after clearing active-stop notice',
    );
  }

  const executorTranscript = `Create ${EXECUTOR_FILE} with ${EXECUTOR_CONTENT.trim()} as its contents.`;
  const runEndCountBeforeExecutor = await evaluate(
    cdp,
    `window.__roroFloatingLiveTurn?.runEnds?.length ?? 0`,
    {},
    'runEnd count before executor turn',
  );
  await evaluate(cdp, `document.getElementById('ask-pill').click()`, {}, 'executor Ask pill click');
  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('expanded')`,
    5000,
    'executor Ask expansion',
  );
  const executorSubmit = await evaluate(cdp, `(() => {
    const input = document.getElementById('ask-input');
    const form = document.getElementById('floating-ask');
    input.value = ${JSON.stringify(executorTranscript)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const notCanceled = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { defaultPrevented: !notCanceled, value: input.value };
  })()`, {}, 'executor Ask form submit');
  check('executor Ask form submit listener prevents native navigation', executorSubmit.defaultPrevented === true, JSON.stringify(executorSubmit));
  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('tasked')`,
    5000,
    'executor Ask tasked state',
  );
  check(
    'executor Ask pill shows the real submitted task',
    await evaluate(cdp, `document.getElementById('ask-pill')?.textContent?.includes(${JSON.stringify(EXECUTOR_FILE)})`, {}, 'executor tasked text check'),
  );
  await waitFor(
    cdp,
    `document.getElementById('floating-stop')?.classList.contains('armed')`,
    10_000,
    'executor Stop armed state',
  );
  check('floating Stop arms for executor turn', await evaluate(cdp, `document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'executor Stop armed check'));

  const executorTurn = await waitFor(
    cdp,
    `(() => {
      const probe = window.__roroFloatingLiveTurn;
      if ((probe?.runEnds?.length ?? 0) <= ${JSON.stringify(runEndCountBeforeExecutor)}) return false;
      const runEnd = probe.runEnds[probe.runEnds.length - 1];
      const events = probe.events.filter((event) => event?.runId === runEnd.runId);
      return { runEnd, events, allEvents: probe.events };
    })()`,
    TURN_TIMEOUT_MS,
    'executor turn runEnd',
  );
  const executorEvents = Array.isArray(executorTurn.events) ? executorTurn.events : [];
  const fileEvents = executorEvents.filter((event) => event?.kind === 'file_change');
  check('executor turn produced scoped events', executorEvents.length > 0, JSON.stringify(executorTurn.allEvents ?? []));
  check('executor turn emitted run.started', executorEvents.some((event) => event?.kind === 'run.started'), JSON.stringify(executorEvents));
  check('executor turn emitted completed file_change', fileEvents.some((event) => event.status === 'completed' && event.files?.some((file) => file.path?.endsWith(EXECUTOR_FILE))), JSON.stringify(executorEvents));
  check('executor turn emitted run.completed', executorEvents.some((event) => event?.kind === 'run.completed'), JSON.stringify(executorEvents));
  check('executor turn produced no run.failed event', !executorEvents.some((event) => event?.kind === 'run.failed'), JSON.stringify(executorEvents));

  await waitFor(
    cdp,
    `document.getElementById('floating-ask')?.classList.contains('collapsed')`,
    5000,
    'executor Ask collapse after runEnd',
  );
  check('floating Ask is collapsed after executor runEnd', await evaluate(cdp, `document.getElementById('floating-ask')?.classList.contains('collapsed')`, {}, 'executor Ask collapse check'));
  check('floating Stop disarms after executor completion', await evaluate(cdp, `!document.getElementById('floating-stop')?.classList.contains('armed')`, {}, 'executor Stop disarmed check'));
  const executorReceipt = await evaluate(cdp, `(() => {
    const el = document.getElementById('floating-error');
    return { hidden: el?.hidden, text: el?.textContent ?? '', success: el?.classList.contains('success') ?? false };
  })()`, {}, 'executor receipt check');
  check('floating receipt is visible for successful executor turn', executorReceipt.hidden === false, JSON.stringify(executorReceipt));
  check('floating receipt has success tone for executor turn', executorReceipt.success === true, JSON.stringify(executorReceipt));
  check('floating receipt reports changed files for executor turn', /^Done\. Changed 1 file\.( Memory (used|checked)\.)?$/.test(executorReceipt.text), JSON.stringify(executorReceipt));
  const codexInvocations = await readFile(fakeCodexArgsFile, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => []);
  const expectedCodexPrefix = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', projectDir];
  const receivedCodexArgs = Array.isArray(codexInvocations)
    ? codexInvocations.map((invocation) => invocation?.args).filter(Array.isArray)
    : [];
  check(
    'fake Codex received the executor CLI shape',
    receivedCodexArgs.some((args) =>
      JSON.stringify(args.slice(0, expectedCodexPrefix.length)) === JSON.stringify(expectedCodexPrefix) &&
      args.at(-1)?.includes(EXECUTOR_FILE)),
    JSON.stringify(codexInvocations),
  );
  check(
    'fake Codex never received the stopped task',
    !receivedCodexArgs.some((args) => args.at(-1)?.includes('stopped before the executor')),
    JSON.stringify(codexInvocations),
  );
  check(
    'fake Codex wrote the requested project file',
    await readFile(join(projectDir, EXECUTOR_FILE), 'utf8').then((text) => text === EXECUTOR_CONTENT).catch(() => false),
  );
  }
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  await browserCdp?.send('Browser.close', {}, 2500).catch(() => undefined);
  cdp?.close();
  browserCdp?.close();
  await stopProcessGroup(child);
  await fakeOllama?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log(`\n[smoke] PASS — real ${SURFACE} turns completed through turnRun with verified runEnd handling.`);
