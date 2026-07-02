# Agent-SDK executor — build spec (W6, task 14)

> Synthesized 2026-07-02 from the verified ground-truth brief (scratchpad/w6-ground-truth.md — READ
> IT FIRST; empirical probes included) + a 3-hat design panel. Status: BUILD SPEC of record.
> Flag-gated dark (`RORO_SDK_EXECUTOR`, deferred-env, both synced copies). The CLI adapter stays
> the default. IMPLEMENTATION STARTS ONLY AFTER W5 (refactor/memory-index) LANDS — both touch
> orchestrator.ts.

## Purpose

Convert the destructive-Bash gate from post-hoc regex abort to PRE-EXECUTION default-deny via the
existing confirmGate, using @anthropic-ai/claude-agent-sdk (exact pin 0.3.198; sdk.d.ts of the
pinned version is the only truth — docs drift).

## Probes FIRST (commit 1 — cheapest-riskiest-first; the version-skew risk is real)

Opt-in live probe tests (env-gated like other live suites) against the founder's REAL CLI
(resolveBin('claude', RORO_CLAUDE_BIN) — 2.1.177 today vs the SDK's paired 2.1.198):
P1 PreToolUse hook observes a CLI-auto-approved command (`echo`) — the hard-invariant assumption;
P2 canUseTool receives a destructive Bash and deny prevents execution; P3 AbortError thrown, no
result message, child dies; P4 settingSources ['project'] keeps the user's global hooks OUT;
P5 plan-mode+Read-only readOnly run cannot write. IF P1 OR P2 FAILS on the user's CLI: flip
pathToClaudeCodeExecutable to the SDK's bundled binary (asar-unpacked platform package) and record
the deviation — do not proceed on broken pairing.

## Adapter (src/executor/claudeSdk.ts + claudeSdkGate.ts)

- Dynamic `await import('@anthropic-ai/claude-agent-sdk')` (ESM-only in CJS main); Vite-bundle
  sdk.mjs statically into the main bundle — no node_modules shipping, no new unpack globs; proven
  by `npm run package` + a new packaged smoke + verify:release-artifact in the gate.
- `buildSdkOptions(opts, gatePort)` PURE + pinned (sibling of claudeArgs):
  cwd=opts.repo; abortController bridged from opts.signal (abort → ac.abort, immediate if already
  aborted); pathToClaudeCodeExecutable = resolveBin('claude', RORO_CLAUDE_BIN);
  env = { ...process.env, PATH: executorPathEnv(...) } (options.env REPLACES — spread is mandatory);
  includePartialMessages: true; permissionMode: readOnly ? 'plan' : 'acceptEdits';
  **allowedTools: readOnly ? ['Read'] : ['Read','Edit','Write'] — Bash DELIBERATELY OFF the list**
  (allow rules precede canUseTool; keeping Bash off makes non-auto-approved Bash hit canUseTool as
  the second layer; the ask itself lives in the hook which precedes everything). readOnly adds
  disallowedTools belt (Bash/Edit/Write/NotebookEdit/Task/WebFetch/WebSearch) + NO hooks + NO gate.
  settingSources: ['project'] (user's global hooks/allow-rules must never run inside roro or widen
  the gate — empirically they fired under the default); persistSession: false;
  systemPrompt { type:'preset', preset:'claude_code' } (SDK default is minimal — restore CLI parity).
- Mapping: REUSE mapClaudeMessage/mapClaudeMessageBlocks/mapClaudeStreamEvent verbatim in the
  fixtures-pinned order; SDKUserMessageReplay explicitly skipped (resume double-emit); result
  error subtypes → run.failed with errors.join('; ') (ADDITIVE arm in mapClaudeMessage — CLI
  behavior byte-identical, pinned); everything else in the 37-member union → null (closed switch,
  default-ignore); usage passes through whole into run.completed.usage.
- AbortError: catch by err.name === 'AbortError' → yield nothing, return → the pump's stopped
  path. All other throws propagate to the pump's stream-threw run.failed arm.

## Permission architecture (claudeSdkGate.ts — pure, injected port, zero electron imports)

- ONE memoized adjudication delegate keyed `${runId}:${toolUseID}`, serving BOTH layers:
  PreToolUse hook (matcher 'Bash', timeout 30s > the 15s confirm window) = the HARD invariant
  (hooks run before everything incl. auto-approval and allow rules); canUseTool = the backstop +
  readOnly closed-world deny floor. No double-ask by construction.
- destructive.ts PRE-SCREENS: only classifyDestructiveCommand(cmd, repo)-positive commands ask
  (confirm-fatigue control; identical classifier exposure to today — document that false negatives
  execute exactly as they do on the CLI path today).
- Ask = one additive optional `ExecutorRunOptions.gate?: DestructiveGate { classify, ask,
  preApprovedReason?, onCleared }` injected by startPump; ask closure wraps
  confirmGate.requestConfirm(runId, summary, pushConfirmRequest) UNCHANGED (no new channels, no
  renderer changes). 15s timeout → default-DENY. Deny/timeout → the tool call is denied with
  interrupt:false (deny message tells the model not to retry destructive variants; memoize the
  deny per reason-class for the run) — THE RUN CONTINUES, never aborts on deny.
- Reason-class memoization: the pre-dispatch destructiveConfirm approval's reason (thread
  ctx.destructiveReason through the existing StageDeps return — the field exists, unpopulated)
  waives matching mid-run asks; each mid-run approval waives its own class; a different class asks
  once. Stop racing a pending ask: the ask closure listens on the pump signal → resolveConfirm
  (runId, false) synchronously → AbortError path; late Approve = confirmGate's unknown-id no-op.
- Deferred command/started emission: the adapter filters command/started from mapper output and
  emits it AFTER the gate decision; approved-destructive itemIds recorded in a ledger consulted by
  the orchestrator-side guard closure (the unchanged post-hoc pump guard becomes a no-op-by-
  construction for SDK runs — belt kept); denied commands emit a status beat, never a command
  event; a Bash tool_result whose id never traversed the hook FAILS the run loudly (gate-bypass
  tripwire). LEDGER-STRING RISK: the guard must compare on the exact ActionEvent command string —
  key the ledger by toolUseID/itemId, never by command-string equality.
- A coding (non-readOnly) SDK run with NO gate binding → runClaudeSdk THROWS (fail loud).

## Selection + flag + rollout

- `RORO_SDK_EXECUTOR` → V0_DEFERRED_ENV_KEYS + scripts/v0-deferred-env.mjs (membership-pinned like
  RORO_EXECUTOR_FACTS); read ONLY via guardDeferredEnv inside getExecutor: flag on + agent
  'claude' → ClaudeSdkExecutor; else the CLI adapter. executor-facts readOnly asks follow the same
  selection (readOnly invocation shape above).
- AUTH: no API key — the spawned CLI's default credential chain (the founder's claude login).
  Docs/plans/sdk-executor.md gets a verbatim FOUNDER FLAG section quoting the Anthropic
  distribution policy ("Anthropic does not allow third party developers to offer claude.ai login…
  use API key authentication") — a pre-registered v2 gate for any distributed build.
- Version policy: exact pin, committed lockfile, no auto-bumps; deliberate bumps gated on
  CHANGELOG + sdk.d.ts diff + fixtures + packaged smoke + one live run.
- v2 default-flip criteria (pre-registered): probes green across 2 SDK bumps, a founder month of
  flag-on dogfooding with zero gate bypasses (the tripwire never fired), and the packaged smoke in CI.

## Commit order (each gated: full vitest serialized + tsc + eslint 0 errors; packaged proof where marked)

C0 spec → docs/plans/sdk-executor.md. C1 PROBES (opt-in live suite + results recorded in the
commit message; binary-strategy decision point). C2 deps: exact-pin install (--package-lock-only
+ real install for the probe run), Vite main-config bundling (packaged proof: npm run package +
verify:release-artifact). C3 claudeSdkGate.ts pure core + tests (memoized delegate, reason-class
memoization, deny-continues, Stop race, ledger, bypass tripwire). C4 claudeSdk.ts adapter +
buildSdkOptions pins + sdkMessageToEvents against a captured live fixture (claudeSdkSample.ts) +
the additive mapClaudeMessage error arm (CLI fixtures byte-identical). C5 startPump gate injection
+ getExecutor selection + flag (membership pin) + orchestrator wiring test (flag off → CLI adapter;
locate-gate lesson applies). C6 packaged smoke (smoke-packaged-sdk-executor: flag on, fake-free
spawn of the real CLI in a disposable repo, one gated destructive ask auto-denied by timeout,
run completes) + docs. LIVE FOUNDER SMOKE at the end: real coding turn, real chip approval,
observed pre-execution deny — recorded in the PR body.

---

## Build record (W6, feat/sdk-executor)

Implemented C0–C6, one commit each. Every commit gated: full `npx vitest run` (parallel) → `npx tsc
--noEmit` → eslint 0 errors (worktree scope: `--no-eslintrc -c .eslintrc.json --resolve-plugins-
relative-to . src scripts *.ts`; verified parity with the main checkout — 0 errors, warnings only).
Final suite: 1004+ passed, 11 skipped (live probe suites gated off by default).

### C1 probe results (SDK 0.3.198 ⇄ the founder's REAL installed CLI, which auto-updated to the
SDK-paired 2.1.198 before C1 — the ground-truth-era 2.1.177 skew resolved itself):

| Probe | Result | Note |
|-------|--------|------|
| P1 PreToolUse hook observes an auto-approved `echo` | PASS | hook fired, 0 canUseTool calls |
| P2 canUseTool deny prevents execution (`permissionMode:'default'`) | PASS (amended) | acceptEdits auto-approves workspace Bash → probed the backstop under 'default' |
| P2b PreToolUse hook DENY blocks a destructive Bash under acceptEdits | PASS (added) | THE hard-gate invariant for coding runs |
| P3 abort → AbortError, no result first | PASS | `instanceof AbortError` but `.name==='Error'` (minified) — discriminate by instanceof, not name |
| P4 `settingSources:['project']` keeps the user's global config out | PASS | init mode 'default' (not the user's 'auto'); `git commit` reached canUseTool (local allow rule did not leak) |
| P5 plan + `allowedTools:['Read']` cannot write | PASS | asked-for file never landed |

BINARY-STRATEGY DECISION: keep `pathToClaudeCodeExecutable` = the user's installed CLI
(`resolveBin`). P1/P2b passed on it; NO flip to the SDK's 229MB bundled binary. The
acceptEdits-auto-approves-workspace-`rm -rf` behavior is IDENTICAL on the bundled binary, so it is a
semantic property of CLI 2.1.198, not pairing skew — the PreToolUse hook is the load-bearing
pre-execution gate; canUseTool is the backstop.

### Deviations from the spec (kept every test green + meaningful)

1. **P2 shape.** As literally specced (canUseTool sees the destructive Bash) is FALSE under
   acceptEdits on 2.1.198 (auto-approved first). Amended to `permissionMode:'default'` + added P2b for
   the coding shape.
2. **AbortError discrimination.** Spec said `err.name === 'AbortError'`; the real (minified) class has
   `.name === 'Error'`. The adapter discriminates by `instanceof AbortError`.
3. **Gate-bypass tripwire.** The spec's "a Bash tool_result whose id never traversed the hook" is
   unfalsifiable given the adapter adjudicates every Bash `command`/started. Implemented as the
   STRONGER, operative invariant: a gate-DENIED command whose tool_result comes back `is_error:false`
   (it executed anyway) fails the run loud.

## FOUNDER FLAG — auth policy (pre-registered v2 gate)

The SDK path uses NO API key: the spawned CLI's default credential chain — the founder's own
`claude login` (macOS Keychain OAuth, `apiKeySource: 'none'`, billed to the subscription). Verified
live in C1 and in the packaged C6 smoke.

Anthropic's distribution policy (quoted verbatim from the Agent SDK overview,
code.claude.com/docs/en/agent-sdk/overview):

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai
> login or rate limits for their products, including agents built on the Claude Agent SDK. Please use
> the API key authentication methods described in this document instead."

Interpretation for roro: technically the founder's `claude login` works today with zero API-key
config, so the flag-on **dogfooding** path runs. For any **distributed** build this is a compliance
gate — a distributed roro that ships the SDK executor on-by-default would need either Anthropic
approval or a switch to API-key auth. This is a PRE-REGISTERED v2 gate: it must be resolved before the
default flips from the CLI adapter to the SDK executor for shipped builds.

### v2 default-flip criteria (pre-registered)

Flip `RORO_SDK_EXECUTOR` from dark to default only when ALL hold: probes green across ≥2 SDK bumps; a
founder-month of flag-on dogfooding with ZERO gate bypasses (the tripwire never fires); the packaged
SDK smoke wired into CI; AND the auth-policy gate above resolved for the target distribution.

## C6 packaged smoke + the LIVE FOUNDER SMOKE

`npm run verify:packaged-sdk-executor` (scripts/smoke-packaged-sdk-executor.mjs) launches the REAL
packaged .app with `RORO_SDK_EXECUTOR=1` and drives a coding turn whose task text is non-destructive
(pre-dispatch confirm passes) but induces a mid-run `rm -rf` — auto-denied by the 15s confirm timeout,
proving the deny is PRE-EXECUTION (the target folder survives) and the run continues to completion. It
uses the founder's REAL installed claude CLI (no `RORO_CLAUDE_BIN`) with the founder's real login
keychain (do NOT swap the keychain — that hides claude's OAuth token → "Not logged in"). Opt-in
(spends real tokens); not a CI gate.

LIVE FOUNDER SMOKE (the interactive chip-APPROVAL path the timeout smoke can't cover — run by the
founder):
1. `npm run package`
2. Launch: `RORO_SDK_EXECUTOR=1 RORO_DEBUG_BRIDGE=1` (dev channel) with a real project workdir + a
   real logged-in `claude`.
3. Ask a coding task that legitimately needs a destructive step (e.g. "remove the stale build dir and
   rebuild").
4. Observe the confirm chip appear BEFORE the command runs; click Approve.
5. Confirm the command then executes (approved-destructive), the run completes, and re-running the
   same class mid-turn does not re-ask (reason-class memoization).
6. Separately, let a confirm TIME OUT (or Stop mid-confirm) and observe the pre-execution deny +
   "Skipped a destructive command" status beat + the run continuing.
