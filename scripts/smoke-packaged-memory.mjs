// scripts/smoke-packaged-memory.mjs - packaged memory persistence smoke.
//
// This launches the real packaged .app with disposable userData/cwd,
// writes an observation through the renderer memory bridge, terminates the app,
// relaunches the same userData profile, and recalls the observation. By
// default it forces local Ollama offline to keep the persistence gate
// deterministic and prove recency fallback. With
// RORO_PACKAGED_MEMORY_LIVE_TURN=1 it keeps live Ollama enabled and also runs
// one packaged turn through window.companion.turnRun, asserting the brain speaks
// the recalled memory value after relaunch. Neither mode replaces the human
// non-founder "magic moment" test in PUBLIC.md.
//
// Do NOT override HOME here: on macOS Electron safeStorage deliberately uses
// a Keychain backend. The smoke installs a temporary unlocked user keychain for
// the run, then restores the user's original keychain defaults in finally. This
// avoids mutating or blocking on stale ad-hoc Roro Safe Storage items in the
// login keychain while still exercising Electron safeStorage.
//
// Run after `npm run package`:
//   npm run verify:packaged-memory
//   npm run verify:packaged-live-memory-turn   # requires local Ollama + required models
//   npm run verify:packaged-natural-memory-turn # requires local Ollama + required models

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const BOOT_TIMEOUT_MS = Number(process.env.RORO_MEMORY_BOOT_TIMEOUT_MS || 120_000);
const MEMORY_TIMEOUT_MS = Number(process.env.RORO_MEMORY_OP_TIMEOUT_MS || 45_000);
const LIVE_TURN_TIMEOUT_MS = Number(process.env.RORO_MEMORY_LIVE_TURN_TIMEOUT_MS || 120_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_MEMORY_CDP_TIMEOUT_MS || 5000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';
const LIVE_TURN = process.env.RORO_PACKAGED_MEMORY_LIVE_TURN === '1';
const NATURAL_LANGUAGE_TURN = process.env.RORO_PACKAGED_MEMORY_NATURAL_LANGUAGE_TURN === '1';
const NEEDS_LIVE_OLLAMA = LIVE_TURN || NATURAL_LANGUAGE_TURN;

function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}

const APP_BIN = appBinaryPath(process.env.RORO_PACKAGED_APP);
let nextId = 1;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  fail ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(name);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readText(path) {
  return readFile(path, 'utf8').catch(() => '');
}

async function readTraceEvents(path) {
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

function smokeEnv(port, ollamaPort) {
  const env = {
    ...process.env,
    RORO_DEBUG_PORT: String(port),
    RORO_PGLITE_EXT_DEBUG: '1',
    BRAIN_PROVIDER: 'ollama',
  };
  if (!NEEDS_LIVE_OLLAMA) {
    env.OLLAMA_HOST = `http://127.0.0.1:${ollamaPort}`;
    env.OLLAMA_TIMEOUT_MS = '250';
  }
  if (NATURAL_LANGUAGE_TURN) env.RORO_TRACE = '1';
  delete env.RORO_WORKDIR;
  delete env.COMPANION_WORKDIR;
  delete env.RORO_ALLOW_CWD;
  delete env.RORO_DB_DIR;
  delete env.DOTENV_CONFIG_PATH;
  delete env.RORO_VAD_VOICE;
  delete env.RORO_STT_VOICE;
  delete env.RORO_TTS_VOICE;
  return env;
}

function launchApp({ cwd, userDataDir, port, ollamaPort, label }) {
  const child = spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], {
    cwd,
    env: smokeEnv(port, ollamaPort),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const run = { child, logs: [], stopping: false };
  child.on('error', (err) => failures.push(`spawn ${label}: ${err.message}`));
  const collect = (stream, prefix) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue;
        run.logs.push(`${prefix}${line}`);
        if (!run.stopping && /DevTools listening|brain preflight|memory2|safeStorage|keychain|error|failed/i.test(line)) {
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

async function killApp(run) {
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
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${CDP_COMMAND_TIMEOUT_MS}ms`));
      }, CDP_COMMAND_TIMEOUT_MS);
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

async function evaluate(cdp, expression, params = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    ...params,
  });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function runRendererMemoryOp(cdp, expression, label, timeoutMs = MEMORY_TIMEOUT_MS) {
  const key = `__roroMemorySmoke_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  console.log(`[smoke] starting ${label} through renderer bridge...`);
  try {
    await evaluate(
      cdp,
      `(() => {
        const key = ${JSON.stringify(key)};
        window[key] = { done: false };
        setTimeout(() => {
          Promise.resolve()
            .then(() => ${expression})
            .then((value) => { window[key] = { done: true, ok: true, value }; })
            .catch((err) => {
              window[key] = {
                done: true,
                ok: false,
                message: String(err?.message || err),
                stack: String(err?.stack || ''),
              };
            });
        }, 0);
        return true;
      })()`,
    );
  } catch (err) {
    throw new Error(`${label} start failed: ${(err).message}`);
  }
  console.log(`[smoke] ${label} started; waiting up to ${timeoutMs}ms...`);

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      let state;
      try {
        state = await evaluate(cdp, `window[${JSON.stringify(key)}] ?? null`);
      } catch (err) {
        throw new Error(`${label} status poll failed: ${(err).message}`);
      }
      if (state?.done) return state;
      await sleep(500);
    }
    return {
      done: true,
      ok: false,
      message: `${label} timed out after ${timeoutMs}ms`,
    };
  } finally {
    await evaluate(cdp, `delete window[${JSON.stringify(key)}]`).catch(() => {});
  }
}

function liveTurnExpression(transcript, sessionId, timeoutMs) {
  return `new Promise((resolve) => {
    const companion = window.companion;
    if (
      typeof companion?.turnRun !== 'function' ||
      typeof companion?.onActionEvent !== 'function' ||
      typeof companion?.onRunEnd !== 'function'
    ) {
      resolve({ ok: false, message: 'missing companion turn/event bridge' });
      return;
    }

    const events = [];
    let turnResult = null;
    let turnRunId = null;
    let pendingRunEnd = null;
    let settled = false;
    let offEvent = () => {};
    let offRunEnd = () => {};

    const timer = setTimeout(() => {
      finish({ ok: false, message: 'live memory turn timed out after ${timeoutMs}ms' });
    }, ${timeoutMs});

    function cleanup() {
      clearTimeout(timer);
      try { offEvent(); } catch {}
      try { offRunEnd(); } catch {}
    }

    function finish(payload) {
      if (settled) return;
      settled = true;
      cleanup();
      const scopedEvents = turnRunId
        ? events.filter((event) => event?.runId === turnRunId)
        : events;
      resolve({ ...payload, events: scopedEvents, turnResult });
    }

    function finishIfRunEnded() {
      if (!turnRunId || !pendingRunEnd || pendingRunEnd.runId !== turnRunId) return;
      finish({ ok: true, runEnd: pendingRunEnd });
    }

    offEvent = companion.onActionEvent((event) => {
      events.push(event);
    });
    offRunEnd = companion.onRunEnd((runEnd) => {
      pendingRunEnd = runEnd;
      finishIfRunEnded();
    });

    companion.turnRun(${JSON.stringify({ transcript, sessionId })})
      .then((value) => {
        turnResult = value;
        turnRunId = typeof value?.runId === 'string' ? value.runId : null;
        finishIfRunEnded();
      })
      .catch((err) => {
        finish({
          ok: false,
          message: String(err?.message || err),
          stack: String(err?.stack || ''),
        });
      });
  })`;
}

function bootstrapStatusExpression(timeoutMs) {
  return `new Promise((resolve) => {
    const companion = window.companion;
    if (typeof companion?.getBootstrapStatus !== 'function') {
      resolve({ ok: false, message: 'missing bootstrap status bridge' });
      return;
    }

    const deadline = Date.now() + ${timeoutMs};
    async function poll() {
      try {
        const status = await companion.getBootstrapStatus();
        if (status || Date.now() >= deadline) {
          resolve({ ok: Boolean(status), status, message: status ? '' : 'bootstrap status timed out' });
          return;
        }
      } catch (err) {
        resolve({ ok: false, message: String(err?.message || err) });
        return;
      }
      setTimeout(poll, 250);
    }
    poll();
  })`;
}

function profileFactExpression(expectedValue, timeoutMs) {
  return `new Promise((resolve) => {
    if (typeof window.memory?.profile !== 'function') {
      resolve({ ok: false, message: 'missing memory profile bridge' });
      return;
    }

    const expected = ${JSON.stringify(expectedValue)}.toLowerCase();
    const deadline = Date.now() + ${timeoutMs};
    async function poll() {
      try {
        const facts = await window.memory.profile();
        const hit = Array.isArray(facts)
          ? facts.find((fact) => String(fact?.value || fact?.text || '').toLowerCase().includes(expected))
          : null;
        if (hit) {
          resolve({ ok: true, fact: hit, facts });
          return;
        }
        if (Date.now() >= deadline) {
          resolve({ ok: false, message: 'profile fact timed out', facts: Array.isArray(facts) ? facts : [] });
          return;
        }
      } catch (err) {
        resolve({ ok: false, message: String(err?.message || err) });
        return;
      }
      setTimeout(poll, 500);
    }
    poll();
  })`;
}

async function waitForRendererBridge(cdp, child, label) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} app exited before renderer bridge was ready (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const dom = await evaluate(cdp, `(() => {
        const bodyText = document.body?.innerText || '';
        return {
          title: document.title,
          href: location.href,
          bodyText: bodyText.slice(0, 800),
          hasBody: !!document.body,
          memoryRemember: typeof window.memory?.remember,
          memoryRecall: typeof window.memory?.recall,
          memoryProfile: typeof window.memory?.profile,
          bootstrapStatus: typeof window.companion?.getBootstrapStatus,
          turnRun: typeof window.companion?.turnRun,
          onActionEvent: typeof window.companion?.onActionEvent,
          onRunEnd: typeof window.companion?.onRunEnd,
        };
      })()`);
      const bridgeReady =
        dom.hasBody &&
        dom.memoryRemember === 'function' &&
        dom.memoryRecall === 'function' &&
        dom.bootstrapStatus === 'function' &&
        (!NATURAL_LANGUAGE_TURN || dom.memoryProfile === 'function') &&
        (!NEEDS_LIVE_OLLAMA || (
          dom.turnRun === 'function' &&
          dom.onActionEvent === 'function' &&
          dom.onRunEnd === 'function'
        ));
      if (bridgeReady) return dom;
      lastError =
        `hasBody=${dom.hasBody}, memoryRemember=${dom.memoryRemember}, memoryRecall=${dom.memoryRecall}, ` +
        `memoryProfile=${dom.memoryProfile}, bootstrapStatus=${dom.bootstrapStatus}, turnRun=${dom.turnRun}, ` +
        `onActionEvent=${dom.onActionEvent}, onRunEnd=${dom.onRunEnd}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(500);
  }
  throw new Error(`${label} renderer bridge never became ready (${lastError})`);
}

async function withPackagedRenderer({ cwd, userDataDir, label, operation }) {
  const port = await freePort();
  const ollamaPort = await freePort();
  console.log(`[smoke] launching ${label} packaged app (userData=${userDataDir}, RORO_DEBUG_PORT=${port})...`);
  const run = launchApp({ cwd, userDataDir, port, ollamaPort, label });
  let cdp;
  try {
    const target = await waitForRendererTarget(port, run.child, label);
    cdp = cdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const dom = await waitForRendererBridge(cdp, run.child, label);
    const result = await operation({ cdp, evaluate, dom });
    return { ...result, dom, logs: run.logs };
  } finally {
    cdp?.close();
    await killApp(run);
  }
}

async function collectFiles(dir) {
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

async function filesContaining(dir, needle) {
  const needleBytes = Buffer.from(needle);
  const matches = [];
  for (const file of await collectFiles(dir)) {
    try {
      const data = await readFile(file);
      if (data.includes(needleBytes)) matches.push(file);
    } catch {
      // Ignore transient files under the derived PGlite index.
    }
  }
  return matches;
}

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

function installTemporaryKeychain(root) {
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
      errors.push((err).message);
    }
    try {
      if (previousDefault) setDefaultKeychain(previousDefault);
    } catch (err) {
      errors.push((err).message);
    }
    if (errors.length > 0) {
      throw new Error(`failed to restore keychain settings: ${errors.join('; ')}`);
    }
  };
}

if (process.platform !== 'darwin') {
  console.error('[smoke] packaged memory smoke currently targets the darwin .app bundle.');
  process.exit(1);
}
if (!(await exists(APP_BIN))) {
  console.error(`[smoke] missing packaged app binary: ${APP_BIN}`);
  console.error('[smoke] run `npm run package` first, or set RORO_PACKAGED_APP=/absolute/path/to/Roro.app');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'roro-packaged-memory-'));
const cwd = join(root, 'cwd');
const userDataDir = join(root, 'userData');
const sessionA = 'packaged-memory-smoke-a';
const sessionB = 'packaged-memory-smoke-b';
const token = `roro-packaged-memory-${Date.now()}-${randomUUID()}`;
const liveMemoryAnswer = 'ultraviolet';
const text = `Packaged memory smoke token: ${token}. The user's packaged smoke color is ${liveMemoryAnswer}.`;
const naturalMemoryAnswer = 'atlas-copper';
const naturalTeachTranscript = `Please remember this project convention: I always use the codename ${naturalMemoryAnswer} for packaged memory checks.`;
const naturalRecallTranscript = 'What codename do I use for packaged memory checks? Answer with only the remembered codename.';
await mkdir(cwd, { recursive: true });
await mkdir(userDataDir, { recursive: true });
let restoreKeychain = () => {};

try {
  restoreKeychain = installTemporaryKeychain(root);
  const first = await withPackagedRenderer({
    cwd,
    userDataDir,
    label: 'write',
    operation: async ({ cdp, dom }) => {
      check('packaged renderer URL is file:// app.asar', dom.href.startsWith('file://') && dom.href.includes('/Roro.app/Contents/Resources/app.asar/'));
      check('renderer body is not blank', dom.bodyText.includes('Roro'));
      check('memory remember bridge exists', dom.memoryRemember === 'function');
      check('memory recall bridge exists', dom.memoryRecall === 'function');
      check('bootstrap status bridge exists', dom.bootstrapStatus === 'function');
      if (NATURAL_LANGUAGE_TURN) check('memory profile bridge exists for natural-language mode', dom.memoryProfile === 'function');
      if (NEEDS_LIVE_OLLAMA) {
        check('turnRun bridge exists for live turn mode', dom.turnRun === 'function');
        check('action-event bridge exists for live turn mode', dom.onActionEvent === 'function');
        check('runEnd bridge exists for live turn mode', dom.onRunEnd === 'function');
      }

      const input = {
        session_id: sessionA,
        kind: 'observation',
        text,
        payload: { smoke: 'packaged-memory', token },
      };
      const write = await runRendererMemoryOp(cdp, `window.memory.remember(${JSON.stringify(input)})`, 'memory remember');
      let teachBootstrap = null;
      let teachTurn = null;
      let teachProfile = null;
      if (NATURAL_LANGUAGE_TURN) {
        teachBootstrap = await runRendererMemoryOp(
          cdp,
          bootstrapStatusExpression(BOOT_TIMEOUT_MS),
          'teach bootstrap status',
        );
        teachTurn = await runRendererMemoryOp(
          cdp,
          liveTurnExpression(naturalTeachTranscript, sessionA, LIVE_TURN_TIMEOUT_MS),
          'natural-language teach turn',
          LIVE_TURN_TIMEOUT_MS + 5000,
        );
        teachProfile = await runRendererMemoryOp(
          cdp,
          profileFactExpression(naturalMemoryAnswer, MEMORY_TIMEOUT_MS),
          'natural-language profile fact',
          MEMORY_TIMEOUT_MS + 5000,
        );
      }
      return { write, teachBootstrap, teachTurn, teachProfile };
    },
  });

  console.log('[smoke] asserting packaged write...');
  check('memory write bridge resolved', first.write?.ok, first.write?.message);
  const writeValue = first.write?.ok ? first.write.value : null;
  const rowId = typeof writeValue?.id === 'string' ? writeValue.id : '';
  check('remember returned the smoke text', writeValue?.text === text);
  check('remember returned observation kind', writeValue?.kind === 'observation');
  check('remember returned the write session', writeValue?.session_id === sessionA);

  const ownerPath = join(userDataDir, 'owner.json');
  const memoryRoot = join(userDataDir, 'memory', 'memory2');
  const fallbackMemoryRoot = join(cwd, '.roro-memory2');
  const owner = await readJson(ownerPath).catch(() => null);
  const marker = await readJson(join(memoryRoot, 'encryption.json')).catch(() => null);
  const keyStats = await stat(join(memoryRoot, 'key.json')).catch(() => null);
  const manifestText = await readText(join(memoryRoot, 'manifest.jsonl'));
  const episodeFiles = (await collectFiles(join(memoryRoot, 'episode'))).filter((file) => file.endsWith('.jsonl'));
  const episodeText = (await Promise.all(episodeFiles.map((file) => readText(file)))).join('\n');
  const plaintextMatches = await filesContaining(memoryRoot, token);
  const memoryLogs = first.logs.join('\n');

  check('owner.json exists under userData', Boolean(owner?.owner_id));
  check('owner_id is stable for the memory row', owner?.owner_id === writeValue?.owner_id);
  check('remember returned a durable row id', rowId.length > 0);
  check('memory root exists under userData/memory/memory2', await exists(memoryRoot));
  check('cwd fallback .roro-memory2 was not created', !(await exists(fallbackMemoryRoot)));
  check('memory store is marked encrypted', marker?.version === 1 && marker?.mode === 'v1');
  check('encrypted store key.json exists', Boolean(keyStats?.isFile()));
  check('manifest records the episode write', rowId.length > 0 && manifestText.includes(rowId) && manifestText.includes('"op":"put"'));
  check('episode log records the durable row id', rowId.length > 0 && episodeText.includes(rowId));
  check('episode log does not store plaintext text', !episodeText.includes(text));
  check(
    'sealed memory files do not contain the plaintext token',
    plaintextMatches.length === 0,
    plaintextMatches.map((file) => basename(file)).join(', '),
  );
  check('write logs have no memory keychain failure', !/OS keychain unavailable|memory store is locked|cannot encrypt memory/i.test(memoryLogs));

  if (NATURAL_LANGUAGE_TURN) {
    console.log('[smoke] asserting natural-language turn stores a profile fact...');
    const bootstrap = first.teachBootstrap?.value?.status;
    const teach = first.teachTurn?.value;
    const teachEvents = Array.isArray(teach?.events) ? teach.events : [];
    const teachProfile = first.teachProfile?.value;
    const taughtFact = teachProfile?.fact;
    const traceEvents = await readTraceEvents(join(memoryRoot, 'trace.jsonl'));
    const storedExtract = traceEvents.find((event) =>
      event?.kind === 'extract' &&
      event?.sessionId === sessionA &&
      event?.outcome === 'answered' &&
      event?.stage === 'stored',
    );

    check('bootstrap status bridge resolved for natural-language teach turn', first.teachBootstrap?.ok, first.teachBootstrap?.message);
    check(
      'local Ollama brain is ready for natural-language teach turn',
      bootstrap?.ready === true,
      first.teachBootstrap?.value?.message || bootstrap?.message || (bootstrap ? JSON.stringify(bootstrap) : 'missing bootstrap status'),
    );
    check('natural-language teach turn bridge resolved', first.teachTurn?.ok, first.teachTurn?.message);
    check('natural-language teach turn completed with runEnd', teach?.ok === true && Boolean(teach.runEnd), teach?.message);
    check('natural-language teach runEnd matches turnRun result', teach?.runEnd?.runId === teach?.turnResult?.runId);
    check('natural-language teach did not start the coding executor', !teachEvents.some((event) => event?.kind === 'run.started'));
    check('natural-language teach produced no run.failed event', !teachEvents.some((event) => event?.kind === 'run.failed'));
    check('natural-language profile bridge resolved', first.teachProfile?.ok, first.teachProfile?.message);
    check(
      'natural-language profile contains the taught preference',
      String(taughtFact?.value || taughtFact?.text || '').toLowerCase().includes(naturalMemoryAnswer),
      JSON.stringify(teachProfile?.facts ?? []),
    );
    check('natural-language fact source is the teach session', taughtFact?.source?.session_id === sessionA, JSON.stringify(taughtFact));
    check('extraction trace recorded a stored fact for the teach turn', Boolean(storedExtract), JSON.stringify(traceEvents.slice(-12)));
  }

  const second = await withPackagedRenderer({
    cwd,
    userDataDir,
    label: 'recall',
    operation: async ({ cdp, dom }) => {
      check('relaunch renderer URL is file:// app.asar', dom.href.startsWith('file://') && dom.href.includes('/Roro.app/Contents/Resources/app.asar/'));
      check('relaunch memory recall bridge exists', dom.memoryRecall === 'function');
      if (NATURAL_LANGUAGE_TURN) check('relaunch profile bridge exists for natural-language mode', dom.memoryProfile === 'function');
      if (NEEDS_LIVE_OLLAMA) {
        check('relaunch turnRun bridge exists for live turn mode', dom.turnRun === 'function');
        check('relaunch action-event bridge exists for live turn mode', dom.onActionEvent === 'function');
        check('relaunch runEnd bridge exists for live turn mode', dom.onRunEnd === 'function');
      }
      const recall = await runRendererMemoryOp(
        cdp,
        `window.memory.recall(${JSON.stringify({ query: token, k: 5, sessionId: sessionB })})`,
        'memory recall',
      );
      let bootstrap = null;
      let liveTurn = null;
      let naturalProfile = null;
      let naturalTurn = null;
      if (NEEDS_LIVE_OLLAMA) {
        bootstrap = await runRendererMemoryOp(
          cdp,
          bootstrapStatusExpression(BOOT_TIMEOUT_MS),
          'bootstrap status',
        );
      }
      if (LIVE_TURN) {
        liveTurn = await runRendererMemoryOp(
          cdp,
          liveTurnExpression(
            'What is my packaged smoke color? Answer with only the remembered color.',
            sessionB,
            LIVE_TURN_TIMEOUT_MS,
          ),
          'live memory turn',
          LIVE_TURN_TIMEOUT_MS + 5000,
        );
      }
      if (NATURAL_LANGUAGE_TURN) {
        naturalProfile = await runRendererMemoryOp(
          cdp,
          profileFactExpression(naturalMemoryAnswer, MEMORY_TIMEOUT_MS),
          'natural-language profile fact after relaunch',
          MEMORY_TIMEOUT_MS + 5000,
        );
        naturalTurn = await runRendererMemoryOp(
          cdp,
          liveTurnExpression(naturalRecallTranscript, sessionB, LIVE_TURN_TIMEOUT_MS),
          'natural-language recall turn',
          LIVE_TURN_TIMEOUT_MS + 5000,
        );
      }
      return { recall, bootstrap, liveTurn, naturalProfile, naturalTurn };
    },
  });

  console.log('[smoke] asserting packaged recall after full relaunch...');
  const recalled = Array.isArray(second.recall?.value) ? second.recall.value : [];
  const hit = recalled.find((row) => row.text === text);
  const ownerAfterRelaunch = await readJson(ownerPath).catch(() => null);
  check('memory recall bridge resolved after relaunch', second.recall?.ok, second.recall?.message);
  check('recall returned at least one row', recalled.length > 0);
  check('recall returned the smoke token text', Boolean(hit));
  check('recall returned the same durable row id', rowId.length > 0 && hit?.id === rowId);
  check('recalled row has the original session', hit?.session_id === sessionA);
  check('recalled row has numeric similarity', typeof hit?.similarity === 'number' && Number.isFinite(hit.similarity));
  check('owner_id survived relaunch', ownerAfterRelaunch?.owner_id === owner?.owner_id);
  check('recalled row owner matches owner.json', hit?.owner_id === owner?.owner_id);
  check('relaunch logs have no memory keychain failure', !/OS keychain unavailable|memory store is locked|cannot encrypt memory/i.test(second.logs.join('\n')));

  if (NEEDS_LIVE_OLLAMA) {
    const bootstrap = second.bootstrap?.value?.status;
    check('bootstrap status bridge resolved for live turn', second.bootstrap?.ok, second.bootstrap?.message);
    check(
      'local Ollama brain is ready for live turn',
      bootstrap?.ready === true,
      second.bootstrap?.value?.message || bootstrap?.message || (bootstrap ? JSON.stringify(bootstrap) : 'missing bootstrap status'),
    );
  }

  if (LIVE_TURN) {
    console.log('[smoke] asserting packaged live turn uses recalled memory...');
    const live = second.liveTurn?.value;
    const events = Array.isArray(live?.events) ? live.events : [];
    const memoryStatus = events.find((event) => event?.kind === 'status' && /^Memory:/.test(event.text ?? ''));
    const memoryMatch = /^Memory:\s+(\d+) known .+?,\s+(\d+) related /.exec(memoryStatus?.text ?? '');
    const relatedCount = memoryMatch ? Number(memoryMatch[2]) : 0;
    const narration = events
      .filter((event) => event?.kind === 'message')
      .map((event) => event.text)
      .join('\n');

    check('live turn bridge resolved', second.liveTurn?.ok, second.liveTurn?.message);
    check('live turn completed with runEnd', live?.ok === true && Boolean(live.runEnd), live?.message);
    check('live turn runEnd matches turnRun result', live?.runEnd?.runId === live?.turnResult?.runId);
    check('live turn emitted a memory status beat', Boolean(memoryStatus), JSON.stringify(events));
    check('live turn recalled the seeded episodic memory', relatedCount > 0, memoryStatus?.text);
    check('live turn did not start the coding executor', !events.some((event) => event?.kind === 'run.started'));
    check('live turn produced no run.failed event', !events.some((event) => event?.kind === 'run.failed'));
    check(
      'live turn narration includes the recalled memory value',
      narration.toLowerCase().includes(liveMemoryAnswer),
      narration.slice(0, 500),
    );
  }

  if (NATURAL_LANGUAGE_TURN) {
    console.log('[smoke] asserting natural-language fact survives relaunch and is used...');
    const naturalProfile = second.naturalProfile?.value;
    const relaunchedFact = naturalProfile?.fact;
    const natural = second.naturalTurn?.value;
    const naturalEvents = Array.isArray(natural?.events) ? natural.events : [];
    const memoryStatus = naturalEvents.find((event) => event?.kind === 'status' && /^Memory:/.test(event.text ?? ''));
    const memoryMatch = /^Memory:\s+(\d+) known .+?,\s+(\d+) related /.exec(memoryStatus?.text ?? '');
    const knownCount = memoryMatch ? Number(memoryMatch[1]) : 0;
    const narration = naturalEvents
      .filter((event) => event?.kind === 'message')
      .map((event) => event.text)
      .join('\n');

    check('natural-language profile bridge resolved after relaunch', second.naturalProfile?.ok, second.naturalProfile?.message);
    check(
      'natural-language profile still contains the taught preference after relaunch',
      String(relaunchedFact?.value || relaunchedFact?.text || '').toLowerCase().includes(naturalMemoryAnswer),
      JSON.stringify(naturalProfile?.facts ?? []),
    );
    check('natural-language relaunched fact source is the teach session', relaunchedFact?.source?.session_id === sessionA, JSON.stringify(relaunchedFact));
    check('natural-language recall turn bridge resolved', second.naturalTurn?.ok, second.naturalTurn?.message);
    check('natural-language recall turn completed with runEnd', natural?.ok === true && Boolean(natural.runEnd), natural?.message);
    check('natural-language recall runEnd matches turnRun result', natural?.runEnd?.runId === natural?.turnResult?.runId);
    check('natural-language recall emitted a memory status beat', Boolean(memoryStatus), JSON.stringify(naturalEvents));
    check('natural-language recall saw at least one known fact', knownCount > 0, memoryStatus?.text);
    check('natural-language recall did not start the coding executor', !naturalEvents.some((event) => event?.kind === 'run.started'));
    check('natural-language recall produced no run.failed event', !naturalEvents.some((event) => event?.kind === 'run.failed'));
    check(
      'natural-language recall narration includes the taught memory value',
      narration.toLowerCase().includes(naturalMemoryAnswer),
      narration.slice(0, 500),
    );
  }
} catch (err) {
  console.error(`[smoke] harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  try {
    restoreKeychain();
  } catch (err) {
    console.error(`[smoke] keychain restore error: ${err.message}`);
    failures.push(`keychain restore: ${err.message}`);
  }
  if (KEEP) console.log(`[smoke] kept disposable profile at ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n[smoke] FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}

console.log(
  `\n[smoke] PASS - packaged memory writes, stays encrypted, recalls after relaunch${
    LIVE_TURN ? ', and feeds a live turn' : ''
  }${
    NATURAL_LANGUAGE_TURN ? ', and learns a natural-language fact for a relaunch turn' : ''
  }.`,
);
