# Executor-assisted fact extraction — pilot spec (task 10 of the rebuild program)

> Synthesized 2026-07-02 from a 3-hat design panel (architecture-guardian / privacy-trust / test-architect).
> Status: BUILD SPEC of record. Flag-gated pilot (`RORO_EXECUTOR_FACTS`), ships dark, deletable in one commit.

## Why

The memory moat is produced by the weakest model in the stack: qwen2.5:3b extracts behavioral facts at
40% usable-value quality behind a 17-keyword gate. The frontier model (the executor) watches every
dispatched run and is never asked what it learned. Extraction quality is NOT coding quality — the
"no bigger brain" decision does not apply here. This channel asks the executor's model post-run,
grounds its claims deterministically, and stores NOTHING without the user's explicit confirmation.

## Shape

One main-process package `src/main/factProposals/` + one renderer section + 3 IPC channels + one
deferred-env flag. The hook is a fire-and-forget call NEXT TO `runFactExtraction` in
`dispatchExecutor`'s terminal-event branch. The 3B path is untouched (both channels coexist;
factStore's write-chain serializes). No new ActionEvent kinds (frozen union preserved).

## Decisions of record (with dissents)

1. **INPUT — `RunDigest`**, accumulated in dispatchExecutor's existing for-await loop, flag-gated:
   `{ runId, sessionId, repo, agent, task, outcome, finalText?, commands[≤30×200ch], files[≤50], messages[≤10×500ch] }`.
   **Strict privacy rule: the digest contains ONLY provider-already-seen material** — the dispatched
   `task`, the executor's own emitted events, its finalText. NEVER the raw transcript, the 3B
   narration, recalled memory, or profile facts. (Dissent: privacy+test hats included factCtx
   transcript/narration; overruled by the stricter by-construction rule — narration never went to the
   provider.) A purity test pins `buildProposalPrompt` as a function of a RunDigest literal alone.
2. **MECHANISM — one post-run executor ask** behind a `ProposalSource` seam, reusing
   `getExecutor(agent).run()` with a new additive `ExecutorRunOptions.readOnly` (codex
   `--sandbox read-only`; claude plan-mode/no-write-tools). cwd = a scratch temp dir (the digest is
   fully in-prompt; the ask needs zero repo access). If read-only can't be expressed for the installed
   CLI → SKIP + trace (never an agentic ask with write capability). 60s AbortController + the existing
   SIGKILL escalation; ONE proposer slot globally (busy → skip + trace); never touches
   activeRuns/guardedDispatch; `cancelAllProposers()` on will-quit. Fires on `run.completed` only.
   (Dissent: privacy hat wanted a separate reflect.ts spawn path; overruled — adapter reuse inherits
   the spawn/exit/abort landmines for free.) Rejected alternatives: deterministic stream-derivation
   (inference dressed as observation — attributes the executor's choices to the user), 3B-over-digest
   (below its own 40% ceiling on longer input).
3. **ADMISSION (pure, CI-tested)** — `parseProposals` (strict JSON, fence-strip, per-element salvage,
   top-level garbage → [] traced 'malformed') → `admitProposals`: verbatim **evidence grounding**
   (each proposal carries an `evidence` quote that must appear as a normalized substring ≥12 chars in
   the digest's task/messages/finalText/commands — ungrounded → dropped), reuse `normalizeKey` +
   `isUselessValue` exported from extractFact.ts (single source of truth), a secret-shape rejector
   (values that look like tokens/keys/paths-with-credentials), value 3–120 chars, key 2–64,
   **cap 2 per run** (fatigue is this channel's poison mode), dedupe (key,value) against active
   profile (best-effort; memory down → admit without dedupe, traced). Admission decides what is
   SHOWN; the user's Save is the only path to storage.
4. **QUEUE — MAIN in-memory** (`pendingQueue.ts`): cap 6 (oldest evicted, traced), TTL 24h (injected
   clock), evaporates on quit. NOT a 'proposed' state in memory2 (would touch the ≤1-active-per-key
   invariant, recall filtering, reconcile, forgetting — invariant-hostile for a pilot). Recall/decide
   can never see an unconfirmed proposal because it isn't in memory at all. (Dissent: privacy+test
   hats wanted an encrypted queue file; overruled for deletability — a lost proposal is a harmless
   missed fact. Durable queue is a v2 decision gated on the pilot's confirm-rate.)
5. **UX — two surfaces, one queue**: a post-run chip (confirmChip pattern; two-line copy NAMING the
   claiming agent, e.g. "codex noticed something about how you work — review?"; EQUAL-weight
   [Review] / [Dismiss]; 30s auto-hide leaves the proposal pending — silence is neither consent nor
   rejection) + a "Roro noticed — save it?" section in the existing Memory panel (mount pattern from
   forgetPanel; textContent-only) showing key/value + claimed-by + date + the ≤140-char evidence
   quote (informed confirmation beats blind confirmation), per row [Save] / [Not for me]; save
   failure → "Couldn't save. Retry." with the proposal still queued.
6. **CONFIRM path**: MAIN resolves (ownerId injected MAIN-side) →
   `extractAndStoreFact(..., { channel: 'executor', claimedBy, evidence })` → the existing
   replaceFact supersede-not-overwrite chain → one `reinforceFact` (the click modeled as one
   corroboration). Provenance: additive optional fields on FactSource/payload —
   `channel?: 'executor'`, `claimed_by?: AgentKind`, `evidence?: string(≤140)`. No migration; old
   rows parse unchanged. Panel Source detail: "codex suggested this after a coding run; you
   confirmed it. Evidence: …".
7. **EVAL** — `npm run eval:proposals` (opt-in live, NOT CI; burns user quota): digest fixtures in
   two tiers — deterministic (replay executor __fixtures__ through the mappers) and captured
   (opt-in `RORO_TRACE_PROPOSE=plaintext`, hand-sanitized, human-reviewed, CI hygiene test for
   path/key patterns). Apples-to-apples vs the 40% baseline: wrap the 5 BEHAVIORAL_EXTRACT_CASES as
   degenerate digests, score the same `scoreFactValue` axis. Channel axes: grounding-rejection rate,
   proposals-per-run, and (from live piloting) confirm-rate + fix/forget-later rate.
   `proposalBaseline.json` only via `--write-baseline`. Tracer gains additive `kind:'propose'`
   (stages asked/failed/malformed/admitted/queued/confirmed/rejected/expired/skipped_busy — ids,
   keys, counts ONLY; never value/evidence text).
8. **FLAG** — `RORO_EXECUTOR_FACTS` in `V0_DEFERRED_ENV_KEYS` + `scripts/v0-deferred-env.mjs`
   (sync test-enforced; release-channel strip proven by verify:release-channel). Digest accumulation,
   proposer, IPC registration, renderer mount ALL check the guarded env. Ships dark.
   **Pre-registered graduation bars** (flag → settings toggle + quota/consent explainer, a separate
   later decision): confirm-rate ≥60% on shown proposals, grounding-rejection <10%, zero
   secret-shape hits, zero creepiness reports from pilot users.

## Failure paths (each traced, none disturbs the turn)

spawn/timeout/failed ask → trace 'failed', queue untouched · malformed output → [] (salvage valid
elements of a parseable array) · memory down at dedupe → admit without dedupe · memory down at
confirm → invoke rejects, row shows retry, proposal stays queued · renderer gone → safeSend guards;
panel refetches on open · second run while proposer busy → skip + trace · quit → cancelAllProposers
(SIGKILL escalation) + queue evaporates · resolve unknown/expired id → typed 'gone' no-op · flag
off/release → nothing executes, handlers unregistered.

## Deletability

One commit removes: `src/main/factProposals/`, the renderer section+chip, 2 eval files; and reverts:
~15 orchestrator lines, the ipc.ts registration block, the preload bridge block, 3 CH names, 1
deferred-env key (both copies), 2 exports in extractFact.ts, optional fields on
FactSource/ExecutorRunOptions/TraceEvent/roroCfg.

## Build order (TDD, red-first)

1. Pure core: `types.ts` (RunDigest), `buildProposalPrompt` (+ purity test), `parseProposals`,
   `admitProposals` (grounding/guards/caps/dedupe), `pendingQueue` (cap/TTL/idempotence).
2. extractFact.ts exports (normalizeKey, isUselessValue) + secret-shape rejector.
3. Executor `readOnly` option in both adapters (unit tests on arg-building; isolated branch).
4. Proposer: `executorProposalSource` + single-slot runner + cancelAllProposers (fake-executor tests).
5. Orchestrator wiring: digest accumulation + maybeProposeFacts on run.completed (extend the
   orchestrator.factExtraction test harness; assert never-on-failed, never-flag-off, runEnd
   undisturbed by a throwing proposer).
6. IPC + preload + renderer section + chip (jsdom, forgetPanel patterns; flag-off = unregistered).
7. Provenance fields + confirm path (extractAndStoreFact channel; reinforce-on-stored).
8. Tracer 'propose' kind + deferred-env key (sabotage-check the release strip list).
9. Eval runner + fixtures (deterministic tier now; captured tier needs real runs later).
10. Full gate + live loop observation (flag on, real dispatched run, chip → panel → confirm →
    quit/relaunch → recalled) before claiming done.
