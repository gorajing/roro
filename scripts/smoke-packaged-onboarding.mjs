// scripts/smoke-packaged-onboarding.mjs — packaged no-env onboarding smoke.
//
// This launches the real packaged .app from a disposable HOME and cwd, with RORO_WORKDIR stripped,
// so the repo's developer .env cannot hide the first-run packaged-app path. It verifies:
//   1. a fresh profile renders the app and shows the Choose Project banner,
//   2. the preload bridge reports { source: 'unset' },
//   3. a persisted userData/config.json is read on relaunch, hides the banner, and hydrates Settings,
//   4. changing config.json to another repo is reflected on the next launch.
//
// Run after `npm run package`: npm run verify:packaged-onboarding

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const APP_BIN = resolve(
  process.env.RORO_PACKAGED_APP || 'out/Roro-darwin-arm64/Roro.app/Contents/MacOS/Roro',
);
const BOOT_TIMEOUT_MS = 120_000;
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';

let nextId = 1;
const failures = [];

function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
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

function smokeEnv(home, port) {
  const env = { ...process.env, HOME: home, RORO_DEBUG_PORT: String(port) };
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  return stripV0DeferredEnv(env);
}

function launchApp({ home, cwd, userDataDir, port, label }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv(home, port),
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
        if (!run.stopping && /DevTools listening|brain preflight|config|error|failed/i.test(line)) {
          console.log(`[${label}] ${line}`);
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

async function waitForRendererTarget(port, child, label) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} app exited before CDP target appeared`);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // port not up yet, or Chromium is still starting
    }
    await sleep(500);
  }
  throw new Error(`${label} renderer CDP target never appeared on port ${port}`);
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

async function inspectApp({ home, cwd, userDataDir, label }) {
  const port = await freePort();
  console.log(
    `[smoke] launching ${label} packaged app ` +
      `(HOME=${home}, userData=${userDataDir}, RORO_DEBUG_PORT=${port})...`,
  );
  const run = launchApp({ home, cwd, userDataDir, port, label });
  let cdp;
  try {
    const target = await waitForRendererTarget(port, run.child, label);
    cdp = cdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1000);

    const evaluate = async (expression, params = {}) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        ...params,
      });
      if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
      return result.result.value;
    };

    const dom = await evaluate(`(() => {
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
        bodyText: document.body.innerText.slice(0, 800),
        hasTopbar: !!document.querySelector('#topbar'),
        hasOverlay: !!document.querySelector('#overlay'),
        hasPromptForm: !!document.querySelector('#prompt-form'),
        hasWorkdirBanner: !!document.querySelector('#workdir-banner'),
        workdirHidden: document.querySelector('#workdir-banner')?.hidden ?? null,
        workdirText: document.querySelector('#workdir-banner')?.textContent ?? '',
        workdirBannerVisible: visible('#workdir-banner'),
        workdirChooseVisible: visible('#workdir-choose'),
        hasProjectSettings: !!document.querySelector('#project-settings-toggle'),
        projectSettingsVisible: visible('#project-settings-toggle'),
        voiceModeVisible: visible('#voice-mode-btn'),
        muteVisible: visible('#mute-btn'),
        cosmeticsVisible: visible('#cosmetics-toggle'),
        roroVoiceType: typeof window.__roroVoice,
        bridgeType: typeof window.companion?.getWorkdirConfig,
        bg: getComputedStyle(document.body).backgroundColor,
      }})()`);
    const projectSettings = await evaluate(
      `new Promise((resolve) => {
        const visible = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
            rect.width > 0 && rect.height > 0;
        };
        const toggle = document.querySelector('#project-settings-toggle');
        if (!toggle) {
          resolve({ exists: false });
          return;
        }
        toggle.click();
        setTimeout(() => resolve({
          exists: true,
          panelHidden: document.querySelector('#project-settings-panel')?.hidden ?? null,
          panelVisible: visible('#project-settings-panel'),
          current: document.querySelector('#project-settings-current')?.textContent ?? '',
          source: document.querySelector('#project-settings-source')?.textContent ?? '',
          changeVisible: visible('#project-settings-change'),
        }), 250);
      })`,
      { awaitPromise: true },
    );
    const bridge = await evaluate(
      `window.companion.getWorkdirConfig()
        .then((cfg) => ({ ok: true, cfg }))
        .catch((err) => ({ ok: false, message: String(err?.message || err) }))`,
      { awaitPromise: true },
    );

    return { dom, bridge, projectSettings, logs: run.logs };
  } finally {
    cdp?.close();
    await killApp(run);
  }
}

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged onboarding smoke currently targets the darwin .app bundle.');
  process.exit(1);
}
if (!existsSync(APP_BIN)) {
  console.error(`[smoke] missing packaged app: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-onboarding-'));
const home = join(root, 'home');
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
const scratchRepo = join(root, 'chosen-project');
const scratchRepoTwo = join(root, 'next-project');
await mkdir(home, { recursive: true });
await mkdir(cwd, { recursive: true });
await mkdir(userDataDir, { recursive: true });
await mkdir(scratchRepo, { recursive: true });
await mkdir(scratchRepoTwo, { recursive: true });
spawnSync('git', ['init', scratchRepo], { stdio: 'ignore' });
spawnSync('git', ['init', scratchRepoTwo], { stdio: 'ignore' });

try {
  const fresh = await inspectApp({ home, cwd, userDataDir, label: 'fresh' });
  console.log('[smoke] asserting fresh no-env profile...');
  check(
    'packaged renderer URL is file:// app.asar',
    fresh.dom.href.startsWith('file://') && fresh.dom.href.includes('/Roro.app/Contents/Resources/app.asar/'),
  );
  check('renderer body is not blank', fresh.dom.bodyText.includes('Roro'));
  check('#topbar exists', fresh.dom.hasTopbar);
  check('#prompt-form exists', fresh.dom.hasPromptForm);
  check('#workdir-banner exists', fresh.dom.hasWorkdirBanner);
  check('#workdir-banner is visible when no project is configured', fresh.dom.workdirHidden === false);
  check('#workdir-banner is visibly rendered', fresh.dom.workdirBannerVisible);
  check('#workdir-choose is visibly rendered', fresh.dom.workdirChooseVisible);
  check('#workdir-banner asks for a project', /choose a project/i.test(fresh.dom.workdirText));
  check('#project-settings-toggle exists', fresh.dom.hasProjectSettings);
  check('#project-settings-toggle is visibly rendered', fresh.dom.projectSettingsVisible);
  check('Voice Mode control is hidden in default v0 package', fresh.dom.voiceModeVisible === false);
  check('Mute control is hidden in default v0 package', fresh.dom.muteVisible === false);
  check('cosmetics fake-door is absent in default v0 package', fresh.dom.cosmeticsVisible === false);
  check('__roroVoice dev handle is absent in default v0 package', fresh.dom.roroVoiceType === 'undefined');
  check('fresh Settings panel opens', fresh.projectSettings.exists && fresh.projectSettings.panelHidden === false);
  check('fresh Settings reports no project', /no project selected/i.test(fresh.projectSettings.current));
  check('getWorkdirConfig bridge exists', fresh.dom.bridgeType === 'function');
  check('fresh bridge resolves', fresh.bridge.ok);
  check('fresh bridge reports source=unset', fresh.bridge.cfg?.source === 'unset');
  check('fresh bridge has no workdir', !fresh.bridge.cfg?.workdir);
  check('startup does not run the safeStorage readiness probe', !fresh.logs.join('\n').includes('memory-at-rest'));

  const configPath = join(userDataDir, 'config.json');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ workdir: scratchRepo }, null, 2), 'utf8');
  check('config file persisted exactly', JSON.parse(await readFile(configPath, 'utf8')).workdir === scratchRepo);

  const configured = await inspectApp({ home, cwd, userDataDir, label: 'configured' });
  console.log('[smoke] asserting persisted userData/config.json profile...');
  check(
    'configured packaged renderer URL is file:// app.asar',
    configured.dom.href.startsWith('file://') && configured.dom.href.includes('/Roro.app/Contents/Resources/app.asar/'),
  );
  check('configured renderer body is not blank', configured.dom.bodyText.includes('Roro'));
  check('configured bridge resolves', configured.bridge.ok);
  check('configured bridge reports source=config', configured.bridge.cfg?.source === 'config');
  check('configured bridge returns persisted workdir', configured.bridge.cfg?.workdir === scratchRepo);
  check('#workdir-banner hides once config is present', configured.dom.workdirHidden === true);
  check('#workdir-banner is not visibly rendered once config is present', !configured.dom.workdirBannerVisible);
  check('configured Settings panel opens', configured.projectSettings.exists && configured.projectSettings.panelVisible);
  check('configured Settings shows the persisted project', configured.projectSettings.current === scratchRepo);
  check('configured Settings source is saved project', /saved project/i.test(configured.projectSettings.source));
  check('configured Settings can invoke Change Project', configured.projectSettings.changeVisible);
  check('configured startup avoids the safeStorage readiness probe', !configured.logs.join('\n').includes('memory-at-rest'));

  await writeFile(configPath, JSON.stringify({ workdir: scratchRepoTwo }, null, 2), 'utf8');
  check('config file can be changed to a second project', JSON.parse(await readFile(configPath, 'utf8')).workdir === scratchRepoTwo);

  const reconfigured = await inspectApp({ home, cwd, userDataDir, label: 'reconfigured' });
  console.log('[smoke] asserting changed userData/config.json profile...');
  check('reconfigured bridge resolves', reconfigured.bridge.ok);
  check('reconfigured bridge reports source=config', reconfigured.bridge.cfg?.source === 'config');
  check('reconfigured bridge returns the second persisted workdir', reconfigured.bridge.cfg?.workdir === scratchRepoTwo);
  check('reconfigured Settings shows the second persisted project', reconfigured.projectSettings.current === scratchRepoTwo);
  check('#workdir-banner stays hidden after project change', reconfigured.dom.workdirHidden === true);
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  if (KEEP) console.log(`[smoke] kept disposable home at ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log('\n[smoke] PASS — packaged no-env onboarding renders and persisted config hydrates Settings.');
