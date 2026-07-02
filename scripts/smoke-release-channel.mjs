// scripts/smoke-release-channel.mjs — the acceptance smoke for the cohort/release-mode guard.
//
// Run AFTER a release-channel build: `npm run package:release` then `npm run verify:release-channel`
// (or set RORO_PACKAGED_APP=/abs/path/to/Roro.app).
//
// It launches the RELEASE-channel packaged app with EVERY deferred-v0 feature/debug flag deliberately SET
// in the launch env, and asserts the in-binary guard (src/shared/releaseChannel.ts) refused them all:
//   - window.RORO_CFG.cosmeticsStore === false  (the cosmetics fake-door cannot mount)
//   - window.RORO_CFG.debugBridge   === false   (renderer side)
//   - window.companion.runTask is undefined     (the preload debug-bridge wrappers are NOT exposed — the
//                                                 privileged runTask/brain.* handles stay hidden)
// The RORO_*_VOICE env vars are also SET at launch, but they are no longer guarded flags — the voice stack
// was extracted to packages/voice, so the app has NO voice config surface at all. The smoke asserts the
// stronger by-construction property: no voice key exists in window.RORO_CFG (a reappearing key means voice
// plumbing crept back into MAIN without the packages/voice re-integration checklist).
// On a NON-release (dev/smoke) build the deferred flags would all be honored — so a pass here proves the
// release channel is baked and enforced at launch, not just documented.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const BOOT_TIMEOUT_MS = Number(process.env.RORO_RC_BOOT_TIMEOUT_MS || 120_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_RC_CDP_TIMEOUT_MS || 5000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';

function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}
const APP_BIN = appBinaryPath(process.env.RORO_PACKAGED_APP);

let nextId = 1;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok ${name}`); }
  else { failures.push(name); console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => (port ? resolvePort(port) : reject(new Error('no debug port'))));
    });
  });
}

// The whole point: SET every deferred-v0 flag at launch, so a release build must refuse them all.
function launchEnv(port) {
  const env = {
    ...process.env,
    RORO_DEBUG_PORT: String(port),
    // a dead Ollama so brain preflight fails fast + non-blocking; the window still renders (what we read).
    OLLAMA_HOST: 'http://127.0.0.1:1',
    OLLAMA_TIMEOUT_MS: '250',
    BRAIN_PROVIDER: 'ollama',
    // the deferred-v0 flags we expect the release channel to REFUSE:
    RORO_WS5_STORE: '1',
    RORO_DEBUG_BRIDGE: '1',
    // voice env vars: NOT deferred flags anymore (no app-side reader) — set anyway to prove that even
    // with them in the launch env, no voice config key materializes in window.RORO_CFG.
    RORO_FAKE_VOICE: '1',
    RORO_VAD_VOICE: '1',
    RORO_STT_VOICE: '1',
    RORO_TTS_VOICE: '1',
  };
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  return env;
}

function launchApp(userDataDir, port) {
  return spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    env: launchEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((done) => {
    const timer = setTimeout(() => { child.off('close', onClose); done(false); }, timeoutMs);
    const onClose = () => { clearTimeout(timer); done(true); };
    child.once('close', onClose);
  });
}

async function killApp(child) {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch { /* gone */ } }
  if (await waitForChildExit(child, 5000)) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  await waitForChildExit(child, 2000);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function waitForRendererTarget(port, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app exited before the renderer CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, CDP_COMMAND_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); ok(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

// The CDP page target can appear before the preload's contextBridge has exposed window.RORO_CFG — poll
// for it (and the companion bridge) so the guard assertions never race a still-booting renderer.
async function waitForCfg(cdp) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      cdp,
      'typeof window.RORO_CFG === "object" && window.RORO_CFG !== null && typeof window.companion === "object"',
    );
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log(`[smoke] release-channel acceptance — APP_BIN=${APP_BIN}`);
  const home = await mkdtemp(join(tmpdir(), 'roro-rc-smoke-'));
  const port = await freePort();
  const child = launchApp(home, port);
  child.on('error', (err) => failures.push(`spawn: ${err.message}`));
  let cdp;
  try {
    const target = await waitForRendererTarget(port, child);
    cdp = cdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;

    const cfgReady = await waitForCfg(cdp);
    check('window.RORO_CFG + companion bridge became ready', cfgReady);
    const cfg = await evaluate(cdp, 'JSON.stringify(window.RORO_CFG || null)');
    const parsed = cfg ? JSON.parse(cfg) : null;
    check('window.RORO_CFG is present', !!parsed, String(cfg));
    if (parsed) {
      check('cosmetics fake-door REFUSED (RORO_WS5_STORE=1 ignored)', parsed.cosmeticsStore === false, `cosmeticsStore=${parsed.cosmeticsStore}`);
      check('debug bridge REFUSED in renderer cfg (RORO_DEBUG_BRIDGE=1 ignored)', parsed.debugBridge === false, `debugBridge=${parsed.debugBridge}`);
      const voiceKeys = ['fakeVoice', 'vadVoice', 'sttVoice', 'ttsVoice', 'voicePack'].filter((k) => k in parsed);
      check('NO voice config surface exists (voice extracted to packages/voice)', voiceKeys.length === 0,
        `unexpected RORO_CFG voice keys: ${voiceKeys.join(', ')}`);
    }

    // The REAL privilege boundary: the preload debug-bridge wrappers must NOT be exposed.
    const hasRunTask = await evaluate(cdp, 'typeof (window.companion && window.companion.runTask)');
    check('preload debug bridge NOT exposed (window.companion.runTask undefined)', hasRunTask === 'undefined', `typeof runTask=${hasRunTask}`);
  } catch (err) {
    failures.push(`smoke error: ${err.message}`);
  } finally {
    try { cdp?.close(); } catch { /* ignore */ }
    await killApp(child);
    if (!KEEP) await rm(home, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n[smoke] release-channel acceptance FAILED (${failures.length}): ${failures.join('; ')}`);
    console.error('[smoke] (run `npm run package:release` first — this asserts the RELEASE channel; a dev build would honor the flags.)');
    process.exit(1);
  }
  console.log('\n[smoke] release-channel acceptance PASSED — every deferred-v0 flag was refused.');
}

main();
