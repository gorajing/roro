// scripts/smoke-memory-panel-rendered.mjs - rendered Memory panel keyboard/a11y smoke.
//
// The Memory panel has jsdom tests for DOM logic, but jsdom cannot prove Chromium tab order or
// rendered :focus-visible styles. This launches the real Electron renderer over CDP with a narrow
// renderer-only fake profile fact, then drives Tab/Space/Escape through Input.dispatchKeyEvent.
// It does not enable the debug bridge and it does not touch the real memory store.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const PORT = process.env.RORO_DEBUG_PORT || String(await freePort());
const BOOT_TIMEOUT_MS = 180_000;
const root = await mkdtemp(join(tmpdir(), 'roro-memory-panel-rendered-'));
const inheritedEnv = stripV0DeferredEnv({ ...process.env });
const appEnv = {
  ...inheritedEnv,
  RORO_DEBUG_PORT: PORT,
  RORO_MEMORY_PANEL_SMOKE: '1',
  RORO_DISABLE_MEMORY_WARMUP: '1',
  RORO_DB_DIR: join(root, 'memory'),
  RORO_WORKDIR: process.cwd(),
};
delete appEnv.RORO_DEBUG_BRIDGE;
delete appEnv.RORO_FLOATING_WINDOW;
delete appEnv.RORO_FLOATING_SMOKE;

let nextId = 1;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) console.log(`  OK ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
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

async function waitForRendererTarget(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Electron exited before exposing CDP target (${child.exitCode ?? child.signalCode})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // port not up yet
    }
    await sleep(1000);
  }
  throw new Error(`renderer CDP target never appeared on port ${PORT} within ${BOOT_TIMEOUT_MS}ms`);
}

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

async function evaluate(cdp, expression, options = {}, label = 'evaluation') {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, ...options });
  if (result.exceptionDetails) {
    throw new Error(`${label} failed: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, expression, options, label).catch((err) => ({ ok: false, message: err.message }));
    if (last === true || (last && typeof last === 'object' && last.ok === true)) return last;
    await sleep(100);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
  const event = { key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
}

const tab = (cdp) => key(cdp, 'Tab', 'Tab', 9);
const shiftTab = (cdp) => key(cdp, 'Tab', 'Tab', 9, 8);
const activate = (cdp) => key(cdp, ' ', 'Space', 32);
const escape = (cdp) => key(cdp, 'Escape', 'Escape', 27);

async function active(cdp) {
  return evaluate(cdp, `(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      id: el.id,
      className: typeof el.className === 'string' ? el.className : '',
      tag: el.tagName,
      text: el.textContent || '',
    };
  })()`);
}

async function activeMatches(cdp, selector) {
  return evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`);
}

async function tabUntil(cdp, selector, max = 20) {
  for (let i = 0; i < max; i += 1) {
    if (await activeMatches(cdp, selector)) return true;
    await tab(cdp);
    await sleep(60);
  }
  return activeMatches(cdp, selector);
}

async function focusVisible(cdp, selector) {
  return evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'missing' };
    const style = getComputedStyle(el);
    const width = Number.parseFloat(style.outlineWidth || '0');
    return {
      ok: document.activeElement === el &&
        el.matches(':focus-visible') &&
        style.outlineStyle !== 'none' &&
        width > 0,
      active: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
    };
  })()`);
}

async function requireFocusRing(cdp, selector, label) {
  const ring = await focusVisible(cdp, selector);
  check(`${label} has rendered focus-visible ring`, ring.ok, JSON.stringify(ring));
}

const child = spawn('npm', ['start'], {
  env: appEnv,
  stdio: 'inherit',
  detached: true,
});

let cdp;
try {
  console.log(`[smoke] launching app (RORO_DEBUG_PORT=${PORT})...`);
  const target = await waitForRendererTarget(child);
  cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false });
  await cdp.send('Page.bringToFront');

  await waitFor(cdp, `!!document.getElementById('memory-toggle')`, BOOT_TIMEOUT_MS, 'Memory toggle mount');
  await evaluate(cdp, `document.getElementById('memory-health-dismiss')?.click()`);

  console.log('[smoke] asserting harness isolation...');
  const bridge = await evaluate(cdp, `(() => ({
    memoryPanelSmoke: window.RORO_CFG?.memoryPanelSmoke === true,
    floatingSmoke: window.RORO_CFG?.floatingSmoke === true,
    runTask: typeof window.companion?.runTask,
    brainDecide: typeof window.brain?.decide,
    memoryRemember: typeof window.memory?.remember,
    memoryProfile: typeof window.memory?.profile,
  }))()`);
  check('Memory panel smoke flag is explicitly enabled', bridge.memoryPanelSmoke === true, JSON.stringify(bridge));
  check('floating smoke harness is not enabled', bridge.floatingSmoke === false, JSON.stringify(bridge));
  check('direct runTask debug bridge is absent', bridge.runTask === 'undefined', JSON.stringify(bridge));
  check('direct brain debug bridge is absent', bridge.brainDecide === 'undefined', JSON.stringify(bridge));
  check('direct memory remember bridge is absent', bridge.memoryRemember === 'undefined', JSON.stringify(bridge));
  check('public memory profile bridge remains present but unused by smoke deps', bridge.memoryProfile === 'function', JSON.stringify(bridge));
  const memoryHealth = await evaluate(
    cdp,
    `window.companion.getMemoryHealthStatus()
      .then((status) => ({ ok: status === null, status }))
      .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
    { awaitPromise: true },
    'memory health status check',
  );
  check('startup memory warmup is disabled for this rendered smoke', memoryHealth.ok === true, JSON.stringify(memoryHealth));

  console.log('[smoke] opening panel with real keyboard focus...');
  check('keyboard can reach #memory-toggle', await tabUntil(cdp, '#memory-toggle'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '#memory-toggle', '#memory-toggle');
  await activate(cdp);
  await waitFor(cdp, `!!document.querySelector('#memory-panel:not([hidden]) .memory-row')`, 10_000, 'Memory row render');

  const openState = await evaluate(cdp, `(() => {
    const toggle = document.getElementById('memory-toggle');
    const panel = document.getElementById('memory-panel');
    return {
      toggleExpanded: toggle?.getAttribute('aria-expanded'),
      controls: toggle?.getAttribute('aria-controls'),
      panelRole: panel?.getAttribute('role'),
      panelVisible: panel ? !panel.hidden : false,
      text: document.querySelector('.memory-text')?.textContent || '',
    };
  })()`);
  check('panel opens as an ARIA region controlled by the toggle',
    openState.toggleExpanded === 'true' &&
      openState.controls === 'memory-panel' &&
      openState.panelRole === 'region' &&
      openState.panelVisible,
    JSON.stringify(openState));
  check('smoke fact is rendered', openState.text === 'prefers vim', JSON.stringify(openState));

  console.log('[smoke] asserting row tab order and focus rings...');
  await tab(cdp);
  check('Tab from toggle lands on Looks right', await activeMatches(cdp, '.memory-verify'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-verify', 'Looks right');
  await tab(cdp);
  check('next Tab lands on Fix', await activeMatches(cdp, '.memory-fix'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-fix', 'Fix');
  await tab(cdp);
  check('next Tab lands on Source', await activeMatches(cdp, '.memory-source'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-source', 'Source');

  console.log('[smoke] asserting Source disclosure is keyboard-safe...');
  await activate(cdp);
  await waitFor(cdp, `document.activeElement?.matches('.memory-source') && !!document.querySelector('.memory-source-detail')`, 10_000, 'Source disclosure');
  const sourceState = await evaluate(cdp, `(() => {
    const source = document.querySelector('.memory-source');
    const detail = document.querySelector('.memory-source-detail');
    return {
      expanded: source?.getAttribute('aria-expanded'),
      controls: source?.getAttribute('aria-controls'),
      describedBy: source?.getAttribute('aria-describedby') || '',
      detailId: detail?.id || '',
      tabindex: detail?.getAttribute('tabindex'),
      ariaLabel: detail?.getAttribute('aria-label'),
      text: detail?.textContent || '',
    };
  })()`);
  check('Source disclosure expands with safe metadata',
    sourceState.expanded === 'true' &&
      sourceState.controls === sourceState.detailId &&
      sourceState.describedBy.includes(sourceState.detailId) &&
      sourceState.tabindex === null &&
      sourceState.ariaLabel === null &&
      sourceState.text.includes('No transcript is shown here.'),
    JSON.stringify(sourceState));

  await tab(cdp);
  check('Tab skips Source detail and lands on Forget', await activeMatches(cdp, '.memory-forget'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-forget', 'Forget');
  await shiftTab(cdp);
  check('Shift+Tab returns to Source', await activeMatches(cdp, '.memory-source'), JSON.stringify(await active(cdp)));
  await escape(cdp);
  await waitFor(cdp, `document.activeElement?.matches('.memory-source') && !document.querySelector('.memory-source-detail')`, 10_000, 'Source Escape close');
  check('Escape closes Source detail but keeps panel open',
    await evaluate(cdp, `document.querySelector('.memory-source')?.getAttribute('aria-expanded') === 'false' && !document.getElementById('memory-panel')?.hidden`));

  console.log('[smoke] asserting edit focus path...');
  await shiftTab(cdp);
  check('Shift+Tab from Source lands on Fix', await activeMatches(cdp, '.memory-fix'), JSON.stringify(await active(cdp)));
  await activate(cdp);
  await waitFor(cdp, `document.activeElement?.matches('.memory-edit-input')`, 10_000, 'Edit input focus');
  await requireFocusRing(cdp, '.memory-edit-input', 'Edit input');
  await cdp.send('Input.insertText', { text: 'prefers neovim' });
  await waitFor(cdp, `document.querySelector('.memory-save')?.disabled === false`, 10_000, 'Save enabled');
  await tab(cdp);
  check('Tab from edited input lands on Save', await activeMatches(cdp, '.memory-save'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-save', 'Save');
  await tab(cdp);
  check('next Tab lands on Cancel', await activeMatches(cdp, '.memory-cancel'), JSON.stringify(await active(cdp)));
  await requireFocusRing(cdp, '.memory-cancel', 'Cancel');
  await shiftTab(cdp);
  await shiftTab(cdp);
  await escape(cdp);
  await waitFor(cdp, `document.activeElement?.matches('.memory-fix') && !document.querySelector('.memory-edit-input')`, 10_000, 'Edit Escape close');
  check('Escape closes edit and restores Fix focus', await activeMatches(cdp, '.memory-fix'), JSON.stringify(await active(cdp)));

  console.log('[smoke] asserting panel Escape close...');
  await escape(cdp);
  await waitFor(cdp, `document.getElementById('memory-panel')?.hidden && document.activeElement?.matches('#memory-toggle')`, 10_000, 'Panel Escape close');
  const closedState = await evaluate(cdp, `(() => ({
    panelHidden: document.getElementById('memory-panel')?.hidden ?? false,
    expanded: document.getElementById('memory-toggle')?.getAttribute('aria-expanded'),
    activeToggle: document.activeElement?.matches('#memory-toggle') ?? false,
  }))()`);
  check('Escape closes the panel and restores toggle focus',
    closedState.panelHidden && closedState.expanded === 'false' && closedState.activeToggle,
    JSON.stringify(closedState));
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  cdp?.close();
  await stopProcessGroup(child);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\n[smoke] PASS - Memory panel rendered keyboard/a11y contract holds.');
process.exit(0);
