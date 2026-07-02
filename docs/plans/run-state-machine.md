# Typed run state machine — build spec (W4, task 12)

> Synthesized 2026-07-02 from a 3-hat design panel (state-machine designer / concurrency-invariants
> keeper / test-migration planner). Status: BUILD SPEC of record. Structure refactor ONLY — same
> events, same ordering, same failure modes; ALL 12 orchestrator pin-test files byte-untouched
> until the final cleanup commit.

## Core insight (unanimous)

The orchestrator's lifecycle encodes TWO independent truths that the booleans conflate: **UI truth**
(has runEnd been pushed?) and **process truth** (has the executor child's stream drained?). A
watchdog Stop ends the UI at 1.5s while the slot stays held until drain. So: TWO machines — a
per-turn TURN machine and a per-dispatch PUMP machine. The Turn owns at most one Pump; a
RunRegistry owns all Turns and IS the slot (occupancy = registry membership, not a boolean).

## Files

CREATE under `src/main/run/`: `turnState.ts` (TurnPhase, EndCause, Turn), `runRegistry.ts`
(RunRegistry + module singleton + `__test.reset()` — tests NEED the reset export), `pump.ts`
(PumpPhase, pumpRun, TerminalSynthesis), `gates.ts` (Gate signature, runGates, stage library),
`decisionRouter.ts` (the bounded two-pass decide loop). MODIFY: `orchestrator.ts` stays the facade
at its current path with its exact public surface (runTurn, runTask, cancelTask, cancelAllRuns,
resolveDestructiveConfirm). DO NOT TOUCH: confirmGate.ts, windowRegistry.ts, src/executor/*,
src/shared/events.ts, and all orchestrator.*.test.ts (until the final commit).

## Types (adjudicated across hats)

- `TurnPhase`: `minted → deciding{pass:1|2} → capturing → gating → confirming → dispatching →
  running{pump} → ended{cause}` plus `stopping` (preemption IS a phase, not a set-membership; a
  total `requestStop(): 'stopping'|'aborted-pump'|'ignored'` handles any phase — pre-dispatch
  phases transition to `stopping` (and MUST still `resolveConfirm(runId,false)` to deny a pending
  destructive chip); `running` aborts the pump's controller instead (arming the watchdog);
  `draining`/`ended`/unknown ids return 'ignored'). Explicit `stopCheckpoint` stages consume
  `stopping → ended{stopped}` at: post-decide, post-dwell, post-grounding, post-re-decide,
  post-confirm, and inside the dispatch section.
- `EndCause`: completed | failed{error} | stopped | refused{reason}. `end()` is idempotent-by-return
  and is the ONLY site that pushes runEnd. `to()` throws on illegal edges (fail loud) — but model
  the REAL edges first: decide-throws goes minted/deciding → ended directly; endUi-after-releaseSlot
  in a finally is a tolerated idempotent no-op, never a throw.
- `PumpPhase`: `flowing{abortPending} → finishing{terminal} → draining{uiCause} → closed{outcome}`
  — 4 reachable states replacing 8 boolean combos. `TerminalSynthesis` has NO success arm (the c5
  invariant: a stream ending without a verdict can only synthesize run.failed). Events are dropped
  while `draining` (preserves today's `if (uiEnded) continue`). The slot frees ONLY at `closed`.
- `DispatchSection` (the TOCTOU lock as a type): `registry.tryBeginDispatch()` returns null when a
  section is open OR the slot is occupied (the busy refusal, non-queuing); the section stays open
  across the awaited `isCleanTree` check; `commit(makePump)` is SYNCHRONOUS and is the only way to
  occupy the slot — it registers the pump AND closes the section atomically (the "registers
  activeRuns synchronously before releasing the lock" comment becomes a signature). The
  AbortController is created inside the dispatch section and handed to the pump.

## The W6 seam (why this refactor precedes the SDK executor)

`pumpRun(source: RunSource, …)` where RunSource = AsyncIterable<ActionEvent> + AbortSignal —
exactly today's executor shape; only the dispatchGate call-site resolves `getExecutor(agent)`.
Pre-execution permission asks arrive later as ONE optional field (ExecutorRunOptions.askPermission)
that dispatchGate binds to the existing confirmGate — no pump changes needed for W6.

## Gate pipeline

One stage library, two literal compositions (pin them in a test):
`RUN_AGENT_GATES = [workdir, readiness, destructiveConfirm, stopCheckpoint, dispatch]` (readiness +
narration + factCtx are run_agent-only); `RUN_TASK_GATES = [workdir, destructiveConfirm,
stopCheckpoint, dispatch]`. Every pinned user-facing string moves VERBATIM.

## Migration (each commit: `npx vitest run src/main` → full `npm test` serial → tsc → eslint; all
12 pin files green and byte-identical through commit 4)

- COMMIT 0: this spec lands as docs/plans/run-state-machine.md.
- COMMIT 1 — RunRegistry + TurnPhase (state motion, zero shape change): replace the five module
  mutables 1:1 (mint(); stopRequested checks at every preemptedTurns.has site; guardedDispatch body
  inside the dispatch section; activeRuns.set → pump registration; cancelTask → requestStop wired
  to resolveConfirm(id,false); cancelAllRuns → abortAll()). dispatchExecutor + its three booleans
  stay put. New runRegistry.test.ts unit pins (legal edges, requestStop dispatch table, busy
  non-queuing race, idempotent end, stale-id no-op). Hardest verifies: stopSlotRetention,
  destructiveCommand.
- COMMIT 2 — Pump extraction: dispatchExecutor's loop → pump.ts::pumpRun statement-for-statement,
  typed PumpPhase replacing the booleans; watchdog, re-stamp, destructive guard, no-verdict
  synthesis move with it. Sinks injected: {emit, remember, notify, onVerdict (factExtraction +
  executor-facts hooks), guard, endUi, releaseSlot}. Digest accumulator stays CALLER-side (the
  factProposals exact-key-set pin depends on it). pump.test.ts with fake RunSource + fake timers.
  Hardest: crashAccounting, stopSlotRetention (1501ms watchdog), factProposals.
- COMMIT 3 — Gate pipeline: gates.ts + the two compositions; dispatchGate = {section; isCleanTree
  if destructive; stopCheckpoint; controller; void pumpRun} resolving AT dispatch. captureDecide
  stays in the router (RORO_TRACE pin). gates.test.ts pins the composition arrays literally.
  Hardest: workdir, executorReadiness, dispatchReturn.
- COMMIT 4 — Decision router: actOnDecision → decisionRouter.ts bounded two-pass loop
  (deciding.pass:1|2 kills screenAlreadyCaptured); locate fast path + caption are branches of the
  capture stage; tell → 500ms dwell → checkpoint → capture → checkpoint sequence preserved.
  Hardest: captureScreen (all five), locate (all four).
- COMMIT 5 — Sweep: dead helpers deleted, header comment rewritten. Full gate.
- COMMIT 6 (separate, after green) — test simplification ONLY as listed by the migration hat;
  every deletion justified as "now structurally impossible".

## Baked-in risk mitigations (from the hats' risk lists — each is a known trap)

1. Fake timers: stopSlotRetention fakes setTimeout/Date — pump.ts must call GLOBAL setTimeout at
   fire time, never cache a reference at module load.
2. `vi.mock('../executor')` factories in 10 test files export ONLY getExecutor — no new module may
   runtime-import any other executor export (type-only imports fine).
3. The registry singleton MUST export `__test.reset()`; but note destructiveCommand/stopSlotRetention
   rely on state persisting across sequential runTurns WITHIN one it() — reset only between tests
   if the harness already does an equivalent, otherwise don't add resets to existing pin files
   (they stay byte-identical anyway).
4. requestStop must keep denying a pending destructive confirm in BOTH pre-dispatch and dispatched
   phases; the confirm-deny message deliberately wins over 'stopped' when a Stop races the confirm.
5. Pinned micro-ordering inside the pump loop: stamp → guard → pushEvent → activity/digest →
   terminal hooks → rememberEvent. Preserve exactly.
6. Recall-before-persist + capture_screen reusing the pre-store recall: the router carries the
   recall result through both passes — never re-recall on pass 2.
