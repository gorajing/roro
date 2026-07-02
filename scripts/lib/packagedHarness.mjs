// scripts/lib/packagedHarness.mjs — shared boilerplate for the packaged (.app-over-CDP) smokes.
//
// Every packaged smoke repeats the same dance: build the real .app path, launch it with a disposable
// userData/cwd over a Chrome DevTools Protocol (CDP) port, wait for the renderer target, attach, run an
// operation against `window.*` bridges, then tear the app down. macOS safeStorage needs a Keychain, so
// the memory-family smokes also install a temporary unlocked keychain for the run and restore the user's
// defaults after. That launch/attach/keychain/file plumbing is generic — only the bridge-readiness
// predicate, the env, and the assertions are smoke-specific. Extracting it here stops each smoke from
// carrying (and silently drifting) its own copy of the same ~250 lines.
//
// This module is intentionally assertion-free and env-free: callers build their own env (via `buildEnv`)
// and their own bridge-readiness wait (via `waitForBridge`) and own their `check()` tally. The harness
// only owns process/CDP/keychain lifecycle and read-only filesystem helpers.

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// The default lines worth surfacing to the console from a launched app's stdio (boot progress + the
// failure classes a packaged smoke cares about). Callers can pass their own filter to launchApp.
export const DEFAULT_LOG_FILTER =
  /DevTools listening|brain preflight|memory2|safeStorage|keychain|error|failed/i;

// ---------------------------------------------------------------------------
// App binary resolution + read-only filesystem helpers
// ---------------------------------------------------------------------------

/** Resolve the packaged Roro binary from a raw path or the default per-arch out/ layout. */
export function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readText(path) {
  return readFile(path, 'utf8').catch(() => '');
}

/** Read a JSONL trace file into an array of parsed events (skipping unparseable lines). */
export async function readTraceEvents(path) {
  const text = await readText(path);
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Recursively collect every file (not directory) under `dir`. Tolerant of transient/derived trees. */
export async function collectFiles(dir) {
  const out = [];
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) out.push(next);
    }
  }
  await walk(dir);
  return out;
}

/** Every file under `dir` whose raw bytes contain `needle` (used to prove sealed files hold no plaintext). */
export async function filesContaining(dir, needle) {
  const needleBytes = Buffer.from(needle);
  const matches = [];
  for (const file of await collectFiles(dir)) {
    try {
      const data = await readFile(file);
      if (data.includes(needleBytes)) matches.push(file);
    } catch {
      // Ignore transient files under the derived index.
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Free-port allocation
// ---------------------------------------------------------------------------

/** Allocate an ephemeral loopback port (for the CDP debug port and the offline-Ollama sink). */
export async function freePort() {
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

// ---------------------------------------------------------------------------
// App process lifecycle
// ---------------------------------------------------------------------------

/**
 * Launch the packaged app detached (its own process group so we can SIGTERM the whole tree) with the
 * caller's fully-built env. Returns a `run` handle whose `logs` accumulates every stdio line; lines that
 * match `logFilter` are echoed to the console while the app is live.
 */
export function launchApp({ appBin, cwd, userDataDir, env, label, failures, logFilter = DEFAULT_LOG_FILTER }) {
  const child = spawn(appBin, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const run = { child, logs: [], stopping: false };
  child.on('error', (err) => failures?.push(`spawn ${label}: ${err.message}`));
  const collect = (stream, prefix) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue;
        run.logs.push(`${prefix}${line}`);
        if (!run.stopping && logFilter.test(line)) {
          const display = line.length > 1000 ? `${line.slice(0, 1000)}... [truncated ${line.length - 1000} chars]` : line;
          console.log(`[${label}] ${display}`);
        }
      }
    });
  };
  collect(child.stdout, '');
  collect(child.stderr, '');
  return run;
}

export async function waitForChildExit(child, timeoutMs) {
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

/** SIGTERM (then SIGKILL) the app's whole process group and wait for it to exit. */
export async function killApp(run) {
  run.stopping = true;
  if (!run.child.pid) return;
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

// ---------------------------------------------------------------------------
// CDP attach + evaluate
// ---------------------------------------------------------------------------

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

/** Poll the CDP /json endpoint until a renderer page target with a websocket URL appears (or boot times out). */
export async function waitForRendererTarget(port, child, label, bootTimeoutMs) {
  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} app exited before renderer CDP target appeared (code=${child.exitCode}, signal=${child.signalCode})`);
    }
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

let nextId = 1;

/** Minimal CDP client over the renderer websocket: request/response with per-command timeout. */
export function cdpClient(url, commandTimeoutMs = 5000) {
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
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${commandTimeoutMs}ms`));
      }, commandTimeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          ok(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

/** Runtime.evaluate a returns-by-value expression, throwing on an in-page exception. */
export async function evaluate(cdp, expression, params = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    ...params,
  });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

/**
 * Launch → attach → wait-for-bridge → run `operation` → teardown, with fresh debug + offline-Ollama
 * ports per launch. `buildEnv(debugPort, ollamaPort)` builds the launch env; `waitForBridge(cdp, child,
 * label)` resolves the smoke's readiness DOM snapshot; `operation({ cdp, evaluate, dom })` does the work.
 * Always tears the app down (and closes CDP) in `finally`. Returns `{ ...operationResult, dom, logs }`.
 */
export async function withPackagedRenderer({
  appBin,
  cwd,
  userDataDir,
  label,
  bootTimeoutMs,
  commandTimeoutMs = 5000,
  failures,
  logFilter = DEFAULT_LOG_FILTER,
  buildEnv,
  waitForBridge,
  operation,
}) {
  const port = await freePort();
  const ollamaPort = await freePort();
  console.log(`[smoke] launching ${label} packaged app (userData=${userDataDir}, RORO_DEBUG_PORT=${port})...`);
  const run = launchApp({ appBin, cwd, userDataDir, env: buildEnv(port, ollamaPort), label, failures, logFilter });
  let cdp;
  try {
    const target = await waitForRendererTarget(port, run.child, label, bootTimeoutMs);
    cdp = cdpClient(target.webSocketDebuggerUrl, commandTimeoutMs);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const dom = await waitForBridge(cdp, run.child, label);
    const result = await operation({ cdp, evaluate, dom });
    return { ...result, dom, logs: run.logs };
  } finally {
    cdp?.close();
    await killApp(run);
  }
}

// ---------------------------------------------------------------------------
// Temporary macOS keychain (Electron safeStorage uses a Keychain backend on darwin)
// ---------------------------------------------------------------------------

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

/**
 * Install exit/signal handlers so the keychain `restore` runs even if the smoke is interrupted — a
 * half-restored keychain would poison the developer's login session. Returns an idempotent restore fn.
 */
export function protectKeychainRestore(restore) {
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

/**
 * Create + unlock a throwaway keychain under `root`, make it the ONLY search-list entry and the default,
 * so the run's safeStorage items land there (not the login keychain, whose stale "Roro Safe Storage" ACL
 * can prompt or block). Returns an idempotent restore fn that puts the user's search list + default back.
 */
export function installTemporaryKeychain(root) {
  const previousDefault = readDefaultKeychain();
  const previousSearchList = readKeychainSearchList();
  const keychainPath = join(root, 'roro-packaged-memory-smoke.keychain-db');
  const password = randomUUID();

  runSecurity(['create-keychain', '-p', password, keychainPath]);
  runSecurity(['set-keychain-settings', '-lut', '21600', keychainPath]);
  runSecurity(['unlock-keychain', '-p', password, keychainPath]);
  // Keep the login keychain out of the search list during the smoke. Ad-hoc rebuilds can leave a
  // stale "Roro Safe Storage" item there whose ACL prompts or blocks in Security.framework.
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
