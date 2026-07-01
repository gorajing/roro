// scripts/smoke-packaged-memory-health.mjs — packaged degraded memory/keychain health smoke.
//
// This launches the real packaged .app with a smoke-only forced memory-loader failure. It proves
// Roro boots, shows local Keychain/memory copy, keeps the Memory panel understandable, and can still
// complete a non-memory answer turn. It does NOT mutate the developer's real macOS keychains.
//
// Run after `npm run package`: npm run verify:packaged-memory-health

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const APP_BIN = resolve(
  process.env.RORO_PACKAGED_APP || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`,
);
const BOOT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 30_000;
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';

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
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function startFakeOllama() {
  const server = createHttpServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        models: [
          { name: 'qwen2.5:3b' },
          { name: 'qwen2.5vl:7b' },
          { name: 'nomic-embed-text' },
        ],
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/embed') {
      const raw = await readBody(req);
      let input = '';
      try {
        input = JSON.parse(raw).input;
      } catch {
        // The shape is not important here; this is only a deterministic dimension probe.
      }
      const count = Array.isArray(input) ? input.length : 1;
      const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 0.001 : 0));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ embeddings: Array.from({ length: count }, () => vector) }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const raw = await readBody(req);
      let stream = false;
      try {
        stream = JSON.parse(raw).stream === true;
      } catch {
        // Fall through to non-streaming response.
      }
      const content = JSON.stringify({
        narration: 'Memory is paused, but I can still answer.',
        command: 'answer',
        args: {},
      });
      if (stream) {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(`${JSON.stringify({ message: { content }, done: true })}\n`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content } }));
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`unexpected fake Ollama route: ${req.method} ${req.url}`);
  });

  const port = await freePort();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function smokeEnv({ home, port, ollamaUrl, floating = false }) {
  const env = {
    ...process.env,
    HOME: home,
    RORO_DEBUG_PORT: String(port),
    BRAIN_PROVIDER: 'ollama',
    OLLAMA_HOST: ollamaUrl,
    OLLAMA_TIMEOUT_MS: '5000',
  };
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.COMPANION_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  delete env.COMPANION_FLOATING_WINDOW;
  // Floating is the product default; set the flag explicitly so this harness controls the window mode.
  env.RORO_FLOATING_WINDOW = floating ? '1' : '0';
  const stripped = stripV0DeferredEnv(env);
  stripped.RORO_MEMORY_HEALTH_SMOKE_FAIL = 'keychain';
  return stripped;
}

function launchApp({ home, cwd, userDataDir, port, ollamaUrl, floating = false }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv({ home, port, ollamaUrl, floating }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const run = { child, logs: [], stopping: false };
  const collect = (stream) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue;
        run.logs.push(line);
        if (!run.stopping && /DevTools listening|brain preflight|memory warmup|keychain|error|failed/i.test(line)) {
          const display = line.length > 1000 ? `${line.slice(0, 1000)}... [truncated ${line.length - 1000} chars]` : line;
          console.log(`[app] ${display}`);
        }
      }
    });
  };
  collect(child.stdout);
  collect(child.stderr);
  return run;
}

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app exited before renderer CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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
    awaitPromise: true,
    ...params,
  });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression);
      if (last) return last;
    } catch (err) {
      last = { error: err.message };
    }
    await sleep(250);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

async function inspectPackagedApp({ home, cwd, userDataDir, ollamaUrl, floating = false, exerciseTurn = true }) {
  const port = await freePort();
  const mode = floating ? 'floating' : 'full';
  console.log(`[smoke] launching packaged app (${mode}, HOME=${home}, userData=${userDataDir}, RORO_DEBUG_PORT=${port})...`);
  const run = launchApp({ home, cwd, userDataDir, port, ollamaUrl, floating });
  let cdp;
  try {
    const target = await waitForRendererTarget(port, run.child);
    cdp = cdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    await waitFor(cdp, `document.body?.innerText?.includes('Roro')`, BOOT_TIMEOUT_MS, 'renderer body');
    const health = await waitFor(
      cdp,
      `window.companion?.getMemoryHealthStatus?.().then((s) => s?.state === 'degraded' ? s : null)`,
      HEALTH_TIMEOUT_MS,
      'degraded memory health',
    );

    const banner = await evaluate(cdp, `(() => {
      const rectFor = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const selectorFor = (el) => {
        if (!el) return null;
        const target = el.closest?.('#ask-pill,#ask-input,#floating-ask,#cat-canvas,#memory-health-details,#memory-health-dismiss,#memory-health-banner,#app');
        return target?.id ? '#' + target.id : el.tagName?.toLowerCase?.() ?? null;
      };
      const center = (rect) => rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      const hitAt = (x, y) => selectorFor(document.elementFromPoint(x, y));
      const snapshot = () => {
        const el = document.querySelector('#memory-health-banner');
        const ask = document.querySelector('#floating-ask');
        const details = document.querySelector('#memory-health-details');
        const dismiss = document.querySelector('#memory-health-dismiss');
        const style = el ? getComputedStyle(el) : null;
        const askStyle = ask ? getComputedStyle(ask) : null;
        const detailsStyle = details ? getComputedStyle(details) : null;
        const rect = rectFor(el);
        const askRect = rectFor(ask);
        const detailsRect = rectFor(details);
        const dismissRect = rectFor(dismiss);
        const askCenter = center(askRect);
        const detailsCenter = center(detailsRect);
        const dismissCenter = center(dismissRect);
        return {
          exists: !!el,
          hidden: el?.hidden ?? null,
          visible: !!el && !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          text: el?.textContent ?? '',
          rect,
          viewport: { width: innerWidth, height: innerHeight },
          bodyFloating: document.body.classList.contains('floating-window'),
          askExists: !!ask,
          askVisible: !!ask && askStyle.display !== 'none' && askStyle.visibility !== 'hidden' && askRect.width > 0 && askRect.height > 0,
          askRect,
          detailsVisible: !!details && detailsStyle.display !== 'none' && detailsStyle.visibility !== 'hidden' && detailsRect.width > 0 && detailsRect.height > 0,
          askHit: askCenter ? hitAt(askCenter.x, askCenter.y) : null,
          detailsHit: detailsCenter ? hitAt(detailsCenter.x, detailsCenter.y) : null,
          dismissHit: dismissCenter ? hitAt(dismissCenter.x, dismissCenter.y) : null,
          bannerBackgroundHit: rect ? hitAt(rect.left + 4, rect.top + rect.height / 2) : null,
          catBodyHit: hitAt(innerWidth / 2, innerHeight * 0.38),
          catMiddleHit: hitAt(innerWidth / 2, innerHeight * 0.5),
        };
      };
      const before = snapshot();
      let askAfterClick = null;
      let detailsAfterClick = null;
      if (before.bodyFloating) {
        const askCenter = center(before.askRect);
        const askHit = askCenter ? document.elementFromPoint(askCenter.x, askCenter.y) : null;
        askHit?.click?.();
        const input = document.querySelector('#ask-input');
        const inputStyle = input ? getComputedStyle(input) : null;
        askAfterClick = {
          hitBefore: selectorFor(askHit),
          askClass: document.querySelector('#floating-ask')?.className ?? '',
          inputVisible: !!input && inputStyle.display !== 'none' && inputStyle.visibility !== 'hidden',
          activeElement: document.activeElement?.id ?? '',
        };
        if (before.detailsVisible) {
          document.querySelector('#memory-health-details')?.click();
          detailsAfterClick = snapshot();
        }
      }
      return { ...before, askAfterClick, detailsAfterClick };
    })()`);

    if (!exerciseTurn) return { health, banner, panel: null, turn: null, logs: run.logs };

    const panel = await evaluate(cdp, `new Promise((resolve) => {
      const toggle = document.querySelector('#memory-toggle');
      if (!toggle) {
        resolve({ exists: false });
        return;
      }
      toggle.click();
      setTimeout(() => {
        const row = document.querySelector('.memory-error');
        resolve({
          exists: true,
          panelHidden: document.querySelector('#memory-panel')?.hidden ?? null,
          text: row?.textContent ?? '',
        });
      }, 750);
    })`, { awaitPromise: true });

    const turn = await evaluate(cdp, `new Promise((resolve) => {
      const events = [];
      const ends = [];
      const cleanup = [];
      const done = (value) => {
        while (cleanup.length) {
          try { cleanup.pop()(); } catch {}
        }
        resolve(value);
      };
      cleanup.push(window.companion.onActionEvent((event) => events.push(event)));
      cleanup.push(window.companion.onRunEnd((event) => {
        ends.push(event);
        setTimeout(() => done({ ok: true, events, ends }), 250);
      }));
      window.companion.turnRun({
        transcript: 'Say hello without editing files.',
        sessionId: 'packaged-memory-health-smoke',
      }).catch((err) => done({ ok: false, message: String(err?.message || err), events, ends }));
      setTimeout(() => done({ ok: false, message: 'turn timed out', events, ends }), 15000);
    })`, { awaitPromise: true });

    return { health, banner, panel, turn, logs: run.logs };
  } finally {
    cdp?.close();
    await killApp(run);
  }
}

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged memory-health smoke currently targets the darwin .app bundle.');
  process.exit(1);
}
if (!existsSync(APP_BIN)) {
  console.error(`[smoke] missing packaged app: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro.app');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-memory-health-'));
const home = join(root, 'home');
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
const floatingUserDataDir = join(root, 'floatingUserData');
let fakeOllama;

try {
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(floatingUserDataDir, { recursive: true });
  fakeOllama = await startFakeOllama();
  console.log(`[smoke] fake Ollama listening at ${fakeOllama.url}`);

  const result = await inspectPackagedApp({ home, cwd, userDataDir, ollamaUrl: fakeOllama.url });
  const floating = await inspectPackagedApp({
    home,
    cwd,
    userDataDir: floatingUserDataDir,
    ollamaUrl: fakeOllama.url,
    floating: true,
    exerciseTurn: false,
  });

  console.log('[smoke] asserting degraded packaged memory health...');
  check('memory health is degraded', result.health?.state === 'degraded', JSON.stringify(result.health));
  check('memory health reason is keychain-unavailable', result.health?.reason === 'keychain-unavailable', JSON.stringify(result.health));
  check('memory health banner exists', result.banner.exists);
  check('memory health banner is visible', result.banner.visible, JSON.stringify(result.banner));
  check('memory health banner says local memory is paused', /Local memory is paused/i.test(result.banner.text), result.banner.text);
  check('memory health banner says Roro can still code', /Roro can still code/i.test(result.banner.text), result.banner.text);
  check('memory health banner names macOS Keychain', /macOS Keychain/i.test(result.banner.text), result.banner.text);
  check('memory health banner summary does not suggest cloud/API-key setup', !/cloud|API key/i.test(result.banner.text), result.banner.text);
  check('Memory panel opens', result.panel.exists && result.panel.panelHidden === false, JSON.stringify(result.panel));
  check('Memory panel uses health-aware local copy', /Local memory is paused/i.test(result.panel.text), result.panel.text);
  check('Memory panel says Roro can still code', /Roro can still code/i.test(result.panel.text), result.panel.text);
  check('Memory panel does not suggest cloud/API-key setup', !/cloud|API key/i.test(result.panel.text), result.panel.text);
  check('answer turn completed', result.turn.ok === true && result.turn.ends.length > 0, JSON.stringify(result.turn));
  check('answer turn emitted narration', result.turn.events.some((event) => event?.kind === 'message' && /still answer/i.test(event.text)), JSON.stringify(result.turn.events));
  check('answer turn produced no run.failed event', !result.turn.events.some((event) => event?.kind === 'run.failed'), JSON.stringify(result.turn.events));
  check('floating memory health launch uses floating window mode', floating.banner.bodyFloating === true, JSON.stringify(floating.banner));
  check('floating memory health banner is visible', floating.banner.visible === true, JSON.stringify(floating.banner));
  check('floating Ask remains visible', floating.banner.askVisible === true, JSON.stringify(floating.banner));
  check('floating memory health banner stays in the top chip strip', floating.banner.rect?.bottom <= 48, JSON.stringify(floating.banner));
  check('floating memory health banner stays inside the window', floating.banner.rect?.top >= 0 &&
    floating.banner.rect?.left >= 0 &&
    floating.banner.rect?.right <= floating.banner.viewport?.width &&
    floating.banner.rect?.bottom <= floating.banner.viewport?.height, JSON.stringify(floating.banner));
  check('floating memory health banner does not overlap Ask', !rectsOverlap(floating.banner.rect, floating.banner.askRect), JSON.stringify(floating.banner));
  check('floating memory health banner leaves a large gap above Ask', floating.banner.askRect?.top - floating.banner.rect?.bottom >= 48, JSON.stringify(floating.banner));
  check('floating banner background does not intercept canvas hits', floating.banner.bannerBackgroundHit === '#cat-canvas', JSON.stringify(floating.banner));
  check('floating cat body remains canvas-hit', floating.banner.catBodyHit === '#cat-canvas', JSON.stringify(floating.banner));
  check('floating cat middle remains canvas-hit', floating.banner.catMiddleHit === '#cat-canvas', JSON.stringify(floating.banner));
  check('floating memory details button is hidden to avoid clipped detail copy', floating.banner.detailsVisible === false && floating.banner.detailsHit !== '#memory-health-details', JSON.stringify(floating.banner));
  check('floating memory dismiss button remains hit-testable', floating.banner.dismissHit === '#memory-health-dismiss', JSON.stringify(floating.banner));
  check('floating Ask center hits the Ask pill', floating.banner.askHit === '#ask-pill', JSON.stringify(floating.banner));
  check('floating Ask expands when clicked by hit target', floating.banner.askAfterClick?.hitBefore === '#ask-pill' &&
    floating.banner.askAfterClick?.askClass.includes('expanded') &&
    floating.banner.askAfterClick?.inputVisible === true &&
    floating.banner.askAfterClick?.activeElement === 'ask-input', JSON.stringify(floating.banner));
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  if (fakeOllama) await fakeOllama.close();
  if (KEEP) console.log(`[smoke] kept disposable home at ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log('\n[smoke] PASS — packaged degraded memory health is visible and non-blocking.');
