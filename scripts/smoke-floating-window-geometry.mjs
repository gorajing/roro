// scripts/smoke-floating-window-geometry.mjs — on-screen smoke for roro's DEFAULT window geometry.
//
// roro ships as a floating desktop pet: a transparent, frameless, always-on-top window that spawns in the
// bottom-left corner of the primary display at a compact size, and that the user can drag anywhere. None of
// that (window mode, initial position, size, transparency) is reachable by jsdom unit tests — it lives in
// the MAIN-process BrowserWindow options. This launches the REAL Electron app with the DEFAULT environment
// (NO RORO_FLOATING_WINDOW set) over the Chrome DevTools Protocol and asserts, via the renderer's own
// window.screen* / window.screenX/Y, that the window is:
//   - floating by default        (body.floating-window class + window.RORO_CFG.floatingWindow === true)
//   - transparent (no background) (computed body backgroundColor is fully transparent)
//   - 190 x 200                   (FLOATING_WINDOW_SIZE — half the previous 380 x 400)
//   - in the bottom-left corner   (screenX/Y match the work-area corner within a small margin tolerance)
//   - draggable like Miro         (the companion.moveWindowBy bridge that the drag gesture calls is present)
//
// This is the test that flips with the product default: before the floating-pet default it would FAIL
// (a centered, opaque, 1024x768 framed window). Run on a machine with a display: npm run verify:floating-geometry
// Opt-in / not in CI (needs a GUI + a vite build). Exits non-zero on any failed assertion.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.RORO_DEBUG_PORT || String(await freePort());
const BOOT_TIMEOUT_MS = 180_000;
// The MAIN-process spawn inset (SPAWN_MARGIN_PX in src/main/window.ts) and the dimensions to assert.
const SPAWN_MARGIN_PX = 16;
const EXPECTED_W = 190;
const EXPECTED_H = 200;
// Tolerance: window placement is integer-rounded DIP; allow a couple px of slack for OS rounding/shadows.
const POS_TOLERANCE_PX = 3;

const root = await mkdtemp(join(tmpdir(), 'roro-floating-geometry-'));
const appEnv = {
  ...process.env,
  RORO_DEBUG_PORT: PORT,
  RORO_DB_DIR: join(root, 'memory'),
};
// Crucial: do NOT set RORO_FLOATING_WINDOW — this smoke proves floating is the DEFAULT, not an opt-in.
delete appEnv.RORO_FLOATING_WINDOW;
delete appEnv.COMPANION_FLOATING_WINDOW;
delete appEnv.RORO_DEBUG_BRIDGE;
delete appEnv.RORO_FLOATING_SMOKE;

const failures = [];
let nextId = 1;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
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
    const timer = setTimeout(() => { child.off('close', onClose); resolve(false); }, timeoutMs);
    const onClose = () => { clearTimeout(timer); resolve(true); };
    child.once('close', onClose);
  });
}

async function stopProcessGroup(child) {
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill(); } catch { /* already gone */ } }
  if (await waitForChildExit(child, 5000)) return;
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
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

const child = spawn('npm', ['start'], { env: appEnv, stdio: 'inherit', detached: true });

let cdp;
try {
  console.log(`[smoke] launching app with DEFAULT env (RORO_DEBUG_PORT=${PORT}, RORO_FLOATING_WINDOW unset)…`);
  const target = await waitForRendererTarget();
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(1500); // let the renderer apply the floating CSS + the window settle at its spawn position

  const evalJs = async (expression, options = {}) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, ...options });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  };

  // One round-trip: read the renderer's view of its own window + the display work area (window.screen.avail*).
  const geom = await evalJs(`(() => {
    const cs = getComputedStyle(document.body);
    return {
      floatingClass: document.body.classList.contains('floating-window'),
      cfgFloating: !!(window.RORO_CFG && window.RORO_CFG.floatingWindow),
      bodyBg: cs.backgroundColor,
      screenX: window.screenX,
      screenY: window.screenY,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      availLeft: window.screen.availLeft,
      availTop: window.screen.availTop,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      hasMoveBridge: typeof (window.companion && window.companion.moveWindowBy) === 'function',
    };
  })()`);

  console.log('[smoke] window geometry:', JSON.stringify(geom));

  // 1) Floating is the DEFAULT (no env opt-in was set).
  check('body has the floating-window class by default', geom.floatingClass === true);
  check('window.RORO_CFG.floatingWindow is true by default', geom.cfgFloating === true);

  // 2) Transparent background (no visible window fill). Computed transparent is rgba(0, 0, 0, 0) / transparent.
  const transparentBg = geom.bodyBg === 'rgba(0, 0, 0, 0)' || geom.bodyBg === 'transparent';
  check('body background is fully transparent', transparentBg, `got ${geom.bodyBg}`);

  // 3) Halved size: 190 x 200.
  check('window is 190 wide', Math.abs(geom.outerW - EXPECTED_W) <= POS_TOLERANCE_PX, `outerWidth=${geom.outerW}`);
  check('window is 200 tall', Math.abs(geom.outerH - EXPECTED_H) <= POS_TOLERANCE_PX, `outerHeight=${geom.outerH}`);

  // 4) Bottom-left of the work area: x inset from the left; bottom edge inset above the Dock.
  const expectedX = geom.availLeft + SPAWN_MARGIN_PX;
  const expectedY = geom.availTop + geom.availHeight - geom.outerH - SPAWN_MARGIN_PX;
  check('spawns inset from the LEFT edge of the work area',
    Math.abs(geom.screenX - expectedX) <= POS_TOLERANCE_PX, `screenX=${geom.screenX}, expected≈${expectedX}`);
  check('spawns just above the BOTTOM of the work area',
    Math.abs(geom.screenY - expectedY) <= POS_TOLERANCE_PX, `screenY=${geom.screenY}, expected≈${expectedY}`);

  // 5) Draggable like Miro: the IPC bridge the canvas drag gesture calls is exposed on the default launch.
  check('companion.moveWindowBy drag bridge is present', geom.hasMoveBridge === true);

} catch (err) {
  console.error('[smoke] FATAL', err);
  failures.push(String(err?.message || err));
} finally {
  if (cdp) cdp.close();
  await stopProcessGroup(child);
  await rm(root, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n[smoke] PASSED — roro defaults to a transparent, bottom-left, 190x200, draggable floating pet.');
