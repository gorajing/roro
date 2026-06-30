// scripts/smoke-memory-steered.mjs — the automated "memory steered the coding work" proof.
//
// Run AFTER `npm run package`: `npm run verify:memory-steered` (or RORO_PACKAGED_APP=/abs/Roro.app).
//
// This is the ROADMAP Arc A tracked-gap deliverable that automates the manual memory-steered check, using
// the opt-in DECIDE capture (RORO_TRACE_DECIDE=plaintext). It proves the full chain deterministically:
//   1. Seed a pre-registered SYNTHETIC marker into memory (an observation; not a real preference).
//   2. Run a coding turn whose transcript OMITS the marker (the anti-echo control).
//   3. A fake Ollama (deterministic brain) echoes the marker FROM the recalled RELEVANT MEMORY into the
//      run_agent args.task — exactly the "the brain used what it remembers" behavior under proof.
//   4. Assert the captured `decide` trace event shows the marker in BOTH the DECIDE prompt and args.task,
//      and that a real run_agent coding turn started + reached the (fake) executor with the marker.
// Because the transcript is marker-free, a marker in args.task can ONLY have come from memory.

import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const BOOT_TIMEOUT_MS = Number(process.env.RORO_MS_BOOT_TIMEOUT_MS || 120_000);
const TURN_TIMEOUT_MS = Number(process.env.RORO_MS_TURN_TIMEOUT_MS || 60_000);
const CDP_COMMAND_TIMEOUT_MS = Number(process.env.RORO_MS_CDP_TIMEOUT_MS || 60_000);
const KEEP = process.env.KEEP_RORO_SMOKE_HOME === '1';

// A pre-registered SYNTHETIC marker (idiosyncratic; not real personal data, so the trace is privacy-safe).
const MARKER = 'zircon-quokka-7741';
const TASK_FILE = 'roro-memory-steered-smoke.txt';
const TASK_CONTENT = `memory-steered ok ${MARKER}`;
// The recalled convention that carries the marker.
const SEED_TEXT = `Project convention: always tag the work file with the codename ${MARKER}.`;
// The coding-turn transcript — DELIBERATELY marker-free (the anti-echo control).
const TURN_TRANSCRIPT = 'Set up the project per my saved conventions.';

let nextId = 1;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok ${name}`); }
  else { failures.push(name); console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function appBinaryPath(rawPath) {
  const candidate = resolve(rawPath || `out/Roro-darwin-${process.arch}/Roro.app/Contents/MacOS/Roro`);
  return candidate.endsWith('.app') ? join(candidate, 'Contents', 'MacOS', 'Roro') : candidate;
}
const APP_BIN = appBinaryPath(process.env.RORO_PACKAGED_APP);

async function freePort() {
  return new Promise((ok, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      const port = typeof a === 'object' && a ? a.port : null;
      server.close(() => (port ? ok(port) : reject(new Error('no port'))));
    });
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function sendJson(res, body) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
function fakeEmbedding() { return Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)); } // fixed → recall returns recent rows

// Deterministic fake brain. On the DECIDE call it echoes the marker FROM the recalled RELEVANT MEMORY into
// the run_agent task — never from the transcript (which is marker-free). If the memory didn't carry the
// marker, it answers (so a recall miss is a visible smoke failure, not a false pass).
async function startFakeOllama() {
  const port = await freePort();
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/api/tags') {
        sendJson(res, { models: [{ name: 'qwen2.5:3b' }, { name: 'qwen2.5vl:7b' }, { name: 'nomic-embed-text:latest' }] });
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
        const prompt = Array.isArray(body.messages) ? body.messages.map((m) => m?.content ?? '').join('\n') : '';
        const memorySection = prompt.split('RELEVANT MEMORY:')[1]?.split('USER SAID:')[0] ?? '';
        const memoryHasMarker = memorySection.includes(MARKER);
        const decisionPayload = memoryHasMarker
          ? {
            narration: 'Applying your saved convention now.',
            command: 'run_agent',
            args: { task: `Create ${TASK_FILE} and tag the work with the saved codename ${MARKER}.`, cwd: null },
          }
          : { narration: 'No saved convention found.', command: 'answer', args: {} };
        const decision = JSON.stringify(decisionPayload);
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(`${JSON.stringify({ message: { content: decision }, done: false })}\n`);
          res.end(`${JSON.stringify({ done: true })}\n`);
        } else {
          sendJson(res, { message: { content: decision } });
        }
        return;
      }
      res.writeHead(404); res.end('not found');
    } catch (err) { res.writeHead(500); res.end(String(err?.message || err)); }
  });
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  return { host: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => server.close(ok)) };
}

function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }

// A fake Codex CLI that records the task it was given (so we can prove the executor received the
// marker-laden task) and writes the work file.
async function writeFakeCodexBin(path, argsFile) {
  const scriptPath = `${path}.js`;
  await writeFile(scriptPath, `
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const cwdIndex = args.indexOf('-C');
const repo = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
const argsFile = ${JSON.stringify(argsFile)};
const emit = (e) => console.log(JSON.stringify(e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const prior = (() => { try { const e = JSON.parse(readFileSync(argsFile, 'utf8')); return Array.isArray(e) ? e : []; } catch { return []; } })();
  prior.push({ argv: args, repo });
  writeFileSync(argsFile, JSON.stringify(prior, null, 2), 'utf8');
  emit({ type: 'thread.started', thread_id: 'fake-codex-memory-steered' });
  emit({ type: 'turn.started' });
  await sleep(80);
  const file = join(repo, ${JSON.stringify(TASK_FILE)});
  emit({ type: 'item.started', item: { id: 'f', type: 'file_change', changes: [{ path: file, kind: 'add' }], status: 'in_progress' } });
  writeFileSync(file, ${JSON.stringify(TASK_CONTENT)}, 'utf8');
  await sleep(120);
  emit({ type: 'item.completed', item: { id: 'f', type: 'file_change', changes: [{ path: file, kind: 'add' }], status: 'completed' } });
  emit({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'done', status: 'completed' } });
  emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
})().catch((err) => { console.error(err?.stack || err); process.exit(1); });
`, 'utf8');
  await writeFile(path, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"\n`, 'utf8');
  await chmod(path, 0o755);
}

function smokeEnv({ port, ollamaHost, fakeCodexBin, tracePath, dbDir }) {
  const env = { ...process.env };
  Object.assign(env, {
    BRAIN_PROVIDER: 'ollama',
    OLLAMA_HOST: ollamaHost,
    OLLAMA_TIMEOUT_MS: '5000',
    RORO_DEBUG_PORT: String(port),
    RORO_DEBUG_BRIDGE: '1', // expose window.memory + window.companion (this build is NOT release-channel)
    RORO_CODEX_BIN: fakeCodexBin,
    RORO_TRACE: '1',
    RORO_TRACE_DECIDE: 'plaintext', // capture the full DECIDE prompt + args.task (founder-local proof)
    RORO_TRACE_FILE: tracePath,
    RORO_DB_DIR: dbDir,
  });
  delete env.RORO_WORKDIR; // the workdir comes from the persisted config.json
  delete env.COMPANION_WORKDIR; delete env.RORO_ALLOW_CWD; delete env.DOTENV_CONFIG_PATH;
  delete env.RORO_FLOATING_SMOKE; delete env.RORO_MEMORY_PANEL_SMOKE; delete env.RORO_FLOATING_WINDOW;
  delete env.OLLAMA_MODEL; delete env.OLLAMA_VISION_MODEL; delete env.OLLAMA_EMBED_MODEL; delete env.OLLAMA_EMBED_DIM;
  return env;
}

function launchApp(env, userDataDir) {
  return spawn(APP_BIN, [`--user-data-dir=${userDataDir}`], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  try { const r = await fetch(url, { signal: controller.signal }); if (!r.ok) throw new Error(`${r.status}`); return await r.json(); }
  finally { clearTimeout(timer); }
}
async function waitForRendererTarget(port, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`app exited before CDP target (code=${child.exitCode})`);
    try { const t = await fetchJson(`http://127.0.0.1:${port}/json`); const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('renderer CDP target never appeared');
}
function cdpClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve: ok, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
  });
  const ready = new Promise((ok, reject) => { ws.addEventListener('open', ok); ws.addEventListener('error', () => reject(new Error('CDP ws error'))); });
  const send = (method, params = {}) => new Promise((ok, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, CDP_COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); ok(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitForBridge(cdp, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('app exited before the renderer bridge was ready');
    const dom = await evaluate(cdp, `({
      remember: typeof window.memory?.remember,
      turnRun: typeof window.companion?.turnRun,
      onActionEvent: typeof window.companion?.onActionEvent,
      onRunEnd: typeof window.companion?.onRunEnd,
    })`);
    if (dom.remember === 'function' && dom.turnRun === 'function' && dom.onActionEvent === 'function' && dom.onRunEnd === 'function') return dom;
    await sleep(300);
  }
  throw new Error('renderer bridge (window.memory + window.companion) never became ready');
}

// Run a bridge op (or turn) async in the renderer and poll the result back over CDP.
async function runRendererOp(cdp, expression, label, timeoutMs) {
  const key = `__roroMsSmoke_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await evaluate(cdp, `(() => { const k=${JSON.stringify(key)}; window[k]={done:false};
    setTimeout(() => { Promise.resolve().then(() => ${expression})
      .then((value) => { window[k]={done:true,ok:true,value}; })
      .catch((err) => { window[k]={done:true,ok:false,message:String(err?.message||err)}; }); }, 0);
    return true; })()`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `window[${JSON.stringify(key)}] || {done:false}`);
    if (state.done) return state;
    await sleep(250);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

function turnExpression(transcript, sessionId, timeoutMs) {
  return `new Promise((resolve) => {
    const c = window.companion; const events = []; let runId = null; let settled = false; let pendingEnd = null;
    let offE = () => {}; let offR = () => {};
    const timer = setTimeout(() => finish({ ok:false, message:'turn timed out' }), ${timeoutMs});
    function finish(p){ if(settled) return; settled=true; clearTimeout(timer); try{offE();}catch{} try{offR();}catch{}
      resolve({ ...p, events: runId ? events.filter(e=>e?.runId===runId) : events }); }
    function endIf(){ if(runId && pendingEnd && pendingEnd.runId===runId) finish({ ok:true }); }
    offE = c.onActionEvent((e) => events.push(e));
    offR = c.onRunEnd((e) => { pendingEnd = e; endIf(); });
    c.turnRun(${JSON.stringify({ transcript, sessionId })})
      .then((v) => { runId = typeof v?.runId==='string'? v.runId : null; endIf(); })
      .catch((err) => finish({ ok:false, message:String(err?.message||err) }));
  })`;
}

async function main() {
  console.log(`[smoke] memory-steered proof — APP_BIN=${APP_BIN}`);
  const root = await mkdtemp(join(tmpdir(), 'roro-mem-steered-'));
  const userDataDir = join(root, 'userData');
  const projectDir = join(root, 'project');
  const dbDir = join(userDataDir, 'memory');
  const tracePath = join(root, 'decide.roro-trace.jsonl');
  const fakeCodexBin = join(root, 'fake-codex');
  const fakeCodexArgs = join(root, 'fake-codex-args.json');
  const configPath = join(userDataDir, 'config.json');

  await mkdir(projectDir, { recursive: true });
  await mkdir(dirname(configPath), { recursive: true });
  spawnSync('git', ['init', projectDir], { stdio: 'ignore' });
  await writeFile(configPath, JSON.stringify({ workdir: projectDir }, null, 2), 'utf8');
  await writeFakeCodexBin(fakeCodexBin, fakeCodexArgs);
  const fakeOllama = await startFakeOllama();

  const port = await freePort();
  const child = launchApp(smokeEnv({ port, ollamaHost: fakeOllama.host, fakeCodexBin, tracePath, dbDir }), userDataDir);
  child.on('error', (err) => failures.push(`spawn: ${err.message}`));
  let cdp;
  try {
    const target = await waitForRendererTarget(port, child);
    cdp = cdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await waitForBridge(cdp, child);

    // 1. Seed the marker into memory (an observation — kind:'fact' is forbidden from the renderer).
    const seedInput = { session_id: 'mem-steered', kind: 'observation', text: SEED_TEXT, payload: { smoke: 'memory-steered' } };
    const seed = await runRendererOp(cdp, `window.memory.remember(${JSON.stringify(seedInput)})`, 'seed marker', 30_000);
    check('seeded the marker observation', seed.ok, seed.message);

    // 2. Run a coding turn whose transcript OMITS the marker (anti-echo control).
    check('transcript is marker-free (anti-echo control)', !TURN_TRANSCRIPT.includes(MARKER));
    const turn = await runRendererOp(cdp, turnExpression(TURN_TRANSCRIPT, 'mem-steered', TURN_TIMEOUT_MS), 'coding turn', TURN_TIMEOUT_MS + 5000);
    const events = Array.isArray(turn.value?.events) ? turn.value.events : [];
    check('a real run_agent coding turn started', events.some((e) => e?.kind === 'run.started'), JSON.stringify(events.map((e) => e?.kind)));

    // 3. The DECIDE capture must record the marker in BOTH the prompt and the generated args.task.
    let traceText = '';
    try { traceText = await readFile(tracePath, 'utf8'); } catch { /* missing */ }
    const decideEvents = traceText.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.kind === 'decide');
    check('a decide trace event was captured', decideEvents.length > 0, `events=${decideEvents.length}`);
    const withTask = decideEvents.find((e) => typeof e.task === 'string' && e.task.includes(MARKER));
    check('DECIDE prompt carried the recalled marker (memory reached DECIDE)', decideEvents.some((e) => typeof e.prompt === 'string' && e.prompt.includes(MARKER)));
    check('generated args.task carried the marker (memory shaped the coding task)', !!withTask, decideEvents.map((e) => e.task).join(' | '));
    check('captured command is run_agent', decideEvents.some((e) => e.command === 'run_agent'));

    // 4. The executor received the marker-laden task (the work itself, not just the decision).
    let codexInvocations = [];
    try { codexInvocations = JSON.parse(await readFile(fakeCodexArgs, 'utf8')); } catch { /* none */ }
    const argvText = codexInvocations.map((i) => (i.argv || []).join(' ')).join(' ');
    check('the executor was invoked with the marker-laden task', argvText.includes(MARKER), argvText.slice(0, 300));
  } catch (err) {
    failures.push(`smoke error: ${err.message}`);
  } finally {
    try { cdp?.close(); } catch { /* ignore */ }
    await killApp(child);
    await fakeOllama.close();
    if (!KEEP) await rm(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n[smoke] memory-steered proof FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('\n[smoke] memory-steered proof PASSED — a marker-free request, steered by recalled memory, put the marker into the coding task.');
}

main();
