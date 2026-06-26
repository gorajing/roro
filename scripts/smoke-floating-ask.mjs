// scripts/smoke-floating-ask.mjs — Phase B on-screen smoke test (WS4).
//
// The floating Ask + Stop pill (src/renderer/ask/floatingAsk.ts) are jsdom-unit-tested for DOM logic,
// but jsdom has no CSS layout/visibility — so a CSS regression (collapsed/expanded/tasked, .armed)
// is invisible to the unit suite. This launches the REAL Electron renderer over the Chrome DevTools
// Protocol (via the built-in RORO_DEBUG_PORT hook in src/main.ts) and asserts the rendered DOM
// + COMPUTED CSS visibility, then saves a screenshot. No extra deps: Node's global fetch + WebSocket.
//
// Run on a machine with a display:  npm run verify:floating
// Opt-in / not in CI (needs a GUI + a vite build). Exits non-zero on any failed assertion.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const PORT = process.env.RORO_DEBUG_PORT || String(await freePort());
const BOOT_TIMEOUT_MS = 180_000;
const SHOT = 'docs/verification/floating-ask.png';

let nextId = 1;
const failures = [];
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); failures.push(name); }
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

/** Poll the CDP /json endpoint until the renderer page target appears (or boot times out). */
async function waitForRendererTarget() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // port not up yet — vite is still building / electron not launched.
    }
    await sleep(1000);
  }
  throw new Error(`renderer CDP target never appeared on port ${PORT} within ${BOOT_TIMEOUT_MS}ms`);
}

/** Minimal CDP client over a single WebSocket: send a command, await its matching response. */
function cdpClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('CDP websocket error')));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const child = spawn('npm', ['start'], {
  env: { ...process.env, RORO_DEBUG_PORT: PORT, RORO_FLOATING_WINDOW: '1' },
  stdio: 'inherit',
  detached: true,
});

let cdp;
try {
  console.log(`[smoke] launching app (RORO_DEBUG_PORT=${PORT})…`);
  const target = await waitForRendererTarget();
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(1500); // let the renderer mount floatingAsk + apply CSS

  const evalJs = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  };

  console.log('[smoke] asserting initial render…');
  check('#floating-ask exists', await evalJs(`!!document.getElementById('floating-ask')`));
  check('#floating-ask starts collapsed', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));
  check('#ask-pill reads "Ask Roro…"', await evalJs(`document.getElementById('ask-pill').textContent.includes('Ask Roro')`));
  check('#floating-stop exists and is NOT armed', await evalJs(`!!document.getElementById('floating-stop') && !document.getElementById('floating-stop').classList.contains('armed')`));

  console.log('[smoke] summoning (click the pill) and asserting REAL CSS visibility…');
  await evalJs(`document.getElementById('ask-pill').click()`);
  await sleep(300);
  check('#floating-ask becomes expanded on summon', await evalJs(`document.getElementById('floating-ask').classList.contains('expanded')`));
  check('#ask-input is actually visible (computed display != none)', await evalJs(`getComputedStyle(document.getElementById('ask-input')).display !== 'none'`));

  console.log('[smoke] Esc collapses…');
  await evalJs(`document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(200);
  check('#floating-ask collapses on Escape', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));

  mkdirSync('docs/verification', { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log(`[smoke] screenshot → ${SHOT}`);
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  cdp?.close();
  await stopProcessGroup(child);
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\n[smoke] PASS — floating Ask renders + toggles correctly on-screen.');
process.exit(0);
