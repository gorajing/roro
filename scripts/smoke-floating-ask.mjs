// scripts/smoke-floating-ask.mjs — Phase B on-screen smoke test (WS4).
//
// The floating Ask + Stop pill (src/renderer/ask/floatingAsk.ts) are jsdom-unit-tested for DOM logic,
// but jsdom has no CSS layout/visibility — so a CSS regression (collapsed/expanded/tasked, .armed)
// is invisible to the unit suite. This launches the REAL Electron renderer over the Chrome DevTools
// Protocol (via the built-in RORO_DEBUG_PORT hook in src/main.ts) and asserts the rendered DOM
// + COMPUTED CSS visibility. It enables RORO_FLOATING_SMOKE=1, a renderer-only lifecycle harness
// that injects the same push events the real bridge would deliver without running a real coding agent.
// No extra deps: Node's global fetch + WebSocket.
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
  env: { ...process.env, RORO_DEBUG_PORT: PORT, RORO_FLOATING_WINDOW: '1', RORO_FLOATING_SMOKE: '1' },
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
  const isVisible = (selector) => evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  })()`);

  console.log('[smoke] asserting initial render…');
  check('#floating-ask exists', await evalJs(`!!document.getElementById('floating-ask')`));
  check('#floating-ask starts collapsed', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));
  check('#ask-pill reads "Ask Roro…"', await evalJs(`document.getElementById('ask-pill').textContent.includes('Ask Roro')`));
  check('#floating-stop exists and is NOT armed', await evalJs(`!!document.getElementById('floating-stop') && !document.getElementById('floating-stop').classList.contains('armed')`));
  check('floating smoke harness is explicitly enabled', await evalJs(`!!window.__roroFloatingAskSmoke`));

  console.log('[smoke] summoning (click the pill) and asserting REAL CSS visibility…');
  await evalJs(`document.getElementById('ask-pill').click()`);
  await sleep(300);
  check('#floating-ask becomes expanded on summon', await evalJs(`document.getElementById('floating-ask').classList.contains('expanded')`));
  check('#ask-input is actually visible', await isVisible('#ask-input'));

  console.log('[smoke] Esc collapses…');
  await evalJs(`document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(200);
  check('#floating-ask collapses on Escape', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));

  console.log('[smoke] asserting answer/clarify turn collapse via universal runEnd…');
  await evalJs(`document.getElementById('ask-pill').click()`);
  await sleep(100);
  await evalJs(`window.__roroFloatingAskSmoke.startTask('  explain the status  ')`);
  await sleep(100);
  check('#floating-ask becomes tasked after submit', await evalJs(`document.getElementById('floating-ask').classList.contains('tasked')`));
  check('#ask-pill shows the trimmed tasked text', await evalJs(`document.getElementById('ask-pill').textContent === 'tasked: explain the status'`));
  check('#ask-pill is visible while tasked', await isVisible('#ask-pill'));
  const stopVisibleBeforeRun = await isVisible('#floating-stop');
  check('#floating-stop remains hidden before run.started', await evalJs(`!document.getElementById('floating-stop').classList.contains('armed')`) && !stopVisibleBeforeRun);
  await evalJs(`window.__roroFloatingAskSmoke.runEnd()`);
  await sleep(100);
  check('#floating-ask collapses on runEnd without run.started', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));

  console.log('[smoke] asserting executor run lifecycle: tasked → armed Stop → failure → runEnd…');
  await evalJs(`document.getElementById('ask-pill').click()`);
  await sleep(100);
  await evalJs(`window.__roroFloatingAskSmoke.startTask('add a logout route')`);
  await sleep(100);
  await evalJs(`window.__roroFloatingAskSmoke.action({ kind: 'run.started', runId: 'smoke-run', agent: 'codex', ts: Date.now() })`);
  await sleep(100);
  check('#floating-stop arms on run.started', await evalJs(`document.getElementById('floating-stop').classList.contains('armed')`));
  check('#floating-stop is actually visible when armed', await isVisible('#floating-stop'));
  check('smoke lifecycle captured the active run id', await evalJs(`window.__roroFloatingAskSmoke.state().run.runId === 'smoke-run'`));
  await evalJs(`document.getElementById('floating-stop').click()`);
  check('Stop click targets the captured run id', await evalJs(`window.__roroFloatingAskSmoke.state().cancelRequests.includes('smoke-run')`));
  await evalJs(`window.__roroFloatingAskSmoke.action({ kind: 'run.failed', runId: 'smoke-run', ok: false, error: 'spawn codex ENOENT', ts: Date.now() })`);
  await sleep(100);
  check('#floating-stop disarms on run.failed', await evalJs(`!document.getElementById('floating-stop').classList.contains('armed')`));
  check('#floating-stop is hidden after disarm', !(await isVisible('#floating-stop')));
  check('#floating-error is visible after run.failed', await isVisible('#floating-error'));
  check('#floating-error shows actionable copy', await evalJs(`document.getElementById('floating-error').textContent.includes('Task hit a problem') && document.getElementById('floating-error').textContent.includes('Codex CLI not found') && document.getElementById('floating-error').textContent.includes('RORO_CODEX_BIN')`));
  check('#floating-error hides raw spawn text', await evalJs(`!document.getElementById('floating-error').textContent.includes('spawn codex ENOENT')`));
  await evalJs(`window.__roroFloatingAskSmoke.runEnd()`);
  await sleep(100);
  check('#floating-ask collapses after failed runEnd', await evalJs(`document.getElementById('floating-ask').classList.contains('collapsed')`));
  check('#floating-error remains visible after collapse', await isVisible('#floating-error'));
  await evalJs(`document.getElementById('ask-pill').click()`);
  await sleep(100);
  check('summoning Ask clears the previous failure', await evalJs(`document.getElementById('floating-error').hidden`));

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
