// scripts/smoke-floating-live-turn.mjs — real floating Ask turn smoke.
//
// This is the live counterpart to smoke-floating-ask.mjs. It launches the real
// Electron renderer in floating mode, drives the visible Ask form, and lets the
// product bridge call window.companion.turnRun. By default it starts a tiny fake
// Ollama server for deterministic answer-turn coverage; set
// RORO_FLOATING_LIVE_USE_REAL_OLLAMA=1 to use a real local daemon. It does NOT
// enable RORO_FLOATING_SMOKE, RORO_DEBUG_BRIDGE, runTask, or any direct
// brain/memory debug handle.

import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const PORT = process.env.RORO_DEBUG_PORT || String(await freePort());
const BOOT_TIMEOUT_MS = Number(process.env.RORO_FLOATING_LIVE_BOOT_TIMEOUT_MS || 180_000);
const TURN_TIMEOUT_MS = Number(process.env.RORO_FLOATING_LIVE_TURN_TIMEOUT_MS || 180_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_FLOATING_LIVE_CDP_TIMEOUT_MS || 60_000);
const USE_REAL_OLLAMA = process.env.RORO_FLOATING_LIVE_USE_REAL_OLLAMA === '1';
const EXPECTED = 'roro live turn ok';
const EXECUTOR_FILE = 'roro-floating-executor-smoke.txt';
const EXECUTOR_CONTENT = 'executor turn ok\n';

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
        const decision = JSON.stringify(prompt.includes(EXECUTOR_FILE)
          ? {
              narration: 'On it. I will create the smoke file.',
              command: 'run_agent',
              args: {
                task: `Create ${EXECUTOR_FILE} with exactly ${JSON.stringify(EXECUTOR_CONTENT)} as its contents.`,
                cwd: null,
              },
            }
          : { narration: EXPECTED, command: 'answer', args: {} });
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

async function writeFakeCodexBin(path, argsFile) {
  await writeFile(path, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const cwdIndex = args.indexOf('-C');
const repo = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
const file = join(repo, ${JSON.stringify(EXECUTOR_FILE)});
const content = ${JSON.stringify(EXECUTOR_CONTENT)};
const argsFile = ${JSON.stringify(argsFile)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (event) => console.log(JSON.stringify(event));

(async () => {
  writeFileSync(argsFile, JSON.stringify({ args, repo }, null, 2), 'utf8');
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

const root = await mkdtemp(join(tmpdir(), 'roro-floating-live-turn-'));
const appCwd = process.cwd();
const projectDir = process.env.RORO_FLOATING_LIVE_WORKDIR || join(root, 'project');
const dbDir = join(root, 'memory');
const fakeCodexBin = join(root, 'fake-codex');
const fakeCodexArgsFile = join(root, 'fake-codex-args.json');
await mkdir(projectDir, { recursive: true });
await writeFakeCodexBin(fakeCodexBin, fakeCodexArgsFile);
const fakeOllama = USE_REAL_OLLAMA ? null : await startFakeOllama();
const appEnv = stripV0DeferredEnv({
  ...process.env,
  BRAIN_PROVIDER: 'ollama',
  ...(fakeOllama ? { OLLAMA_HOST: fakeOllama.host, OLLAMA_TIMEOUT_MS: '5000' } : {}),
  RORO_DEBUG_PORT: PORT,
  RORO_FLOATING_WINDOW: '1',
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
    `[smoke] launching floating app for a real turn ` +
      `(RORO_DEBUG_PORT=${PORT}, Ollama=${fakeOllama ? fakeOllama.host : 'real daemon'})...`,
  );
  const target = await waitForRendererTarget(child);
  browserCdp = cdpClient(await browserDebuggerUrl());
  await browserCdp.ready;
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

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
  check('floating error remains hidden for successful answer turn', await evaluate(cdp, `document.getElementById('floating-error')?.hidden === true`, {}, 'error hidden check'));

  const executorTranscript = `Create ${EXECUTOR_FILE} with ${EXECUTOR_CONTENT.trim()} as its contents.`;
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
      if ((probe?.runEnds?.length ?? 0) < 2) return false;
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
  check('floating error remains hidden for successful executor turn', await evaluate(cdp, `document.getElementById('floating-error')?.hidden === true`, {}, 'executor error hidden check'));
  const codexInvocation = await readFile(fakeCodexArgsFile, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  const expectedCodexPrefix = ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', projectDir];
  const receivedCodexArgs = Array.isArray(codexInvocation?.args) ? codexInvocation.args : [];
  check(
    'fake Codex received the executor CLI shape',
    JSON.stringify(receivedCodexArgs.slice(0, expectedCodexPrefix.length)) === JSON.stringify(expectedCodexPrefix) &&
      receivedCodexArgs.at(-1)?.includes(EXECUTOR_FILE),
    JSON.stringify(codexInvocation),
  );
  check(
    'fake Codex wrote the requested project file',
    await readFile(join(projectDir, EXECUTOR_FILE), 'utf8').then((text) => text === EXECUTOR_CONTENT).catch(() => false),
  );
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

console.log('\n[smoke] PASS — real floating Ask turns completed through turnRun and collapsed on runEnd.');
