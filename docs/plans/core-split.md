# Electron-free core split — build spec (W7, task 15)

> Synthesized 2026-07-02 from a 3-hat design panel (boundary / ports / migration — full designs at
> scratchpad/w7-design-{0,1,2}.json, worth skimming for detail). Status: BUILD SPEC of record.
> STRUCTURE REFACTOR ONLY — no behavior change. Branch off main ONLY AFTER W6 (feat/sdk-executor)
> merges; path-freeze src/main/**, src/executor, src/brain, src/memory2, src/vision, src/ambient
> for the duration.

## The adjudicated structure (revises the original "monorepo package" idea — deliberately)

`src/core/` DIRECTORY — no package.json, no workspace, no tsconfig project references. Rationale
(boundary hat, accepted): a package boundary is DECORATIVE — Node/TS resolution walks up, so
`import 'electron'` still resolves inside a packages/core; the lint rule is the real boundary
either way, so ship only the boundary. The voice precedent isolates by EXCLUSION (never imported);
core is the inverse (imported by everything). sharp must stay a root dep (forge unpack globs).
Promotion path stays open: `git mv src/core packages/core/src` later, with the boundary test
already proving zero electron edges. ENFORCEMENT (all three, same commit): (1) eslint
no-restricted-imports + import/no-restricted-paths zones — core may not import electron or
../main|renderer|preload; renderer may not import core (types via shared); (2) a vitest BOUNDARY
TEST that scans src/core for electron references INCLUDING dynamic `import('electron')` (the form
memory2 used) and fails naming the offending file; (3) CI runs both by construction.

## Ports — exactly FOUR + one parameter (no DI framework; the setter/facade precedent)

`src/core/ports/ports.ts`: RendererPushPort {send(channel,...args): boolean} (impl:
sendToPetWindow — windowRegistry/safeSend STAY shell; core's knowledge of "the pet window" reduces
to a push fn — includes the hidden runRegistry→sendToPetWindow edge, do not miss it);
NotificationPort (core keeps notifyJobDone's product logic — titles/truncation/best-effort; shell
wraps Notification.isSupported+show); PointerOverlayPort {showPointForBox} (orchestrator drops its
dynamic import; shell adapter keeps laziness); KeyWrapperPort (memory2 loadCipher pulls the
wrapper via ports() instead of `await import('electron')`; buildSafeStorageWrapper + its policy
STAYS core; shell supplies the raw safeStorage object; the lazySingleton retry-on-rejection
semantics preserved verbatim). `registerPlatformPorts()` at main.ts module scope BEFORE
registerIpcHandlers; fail-LOUD unset getter ("port X not registered — call registerPlatformPorts
at boot"); `__test.reset()`. userData dir is a boot PARAMETER (initOwnerId(dir),
hydrateWorkdirConfig(dir, env)) — not a port; RORO_DB_DIR stays memory2's seam.
`src/core/ports/testing.ts`: installTestPorts(overrides?) → {pushes, notifications, points}
capture arrays — the pin files' new harness.

## Move map (topology-preserving: depth-2 → depth-3 keeps sibling specifiers byte-identical)

ONE atomic git-mv commit: src/executor→src/core/executor (incl. W6's claudeSdk*, __fixtures__),
src/brain→src/core/brain (incl. eval/ — update package.json eval:* paths same commit),
src/memory2→src/core/memory2 (safeStorageWrapper.ts INCLUDED), src/vision→src/core/vision,
src/ambient→src/core/ambient, and the src/main core carve-out→src/core/orchestrator/
(orchestrator.ts, run/, factProposals/, siblings.ts, ports moved earlier land here too, identity,
configStore, workdir, destructive, confirmGate, gitTree, factStore, memoryContext,
executorReadiness, bootstrapPlan/Refresh/StatusStore, memoryHealth*, memoryWarmupFlag — tests ride
along). DOES NOT MOVE: main.ts, preload.ts, renderer*, shared/** (leaf importable by all), types/,
build/, index.css/html, and the shell residue in src/main/: ipc.ts(+tests), window.ts,
windowRegistry.ts, safeSend.ts, pointerOverlay.ts, navigation.ts, openExternalGuard.ts, summon.ts,
processOutput*(+guard), preload.exposure.test.ts, the new adapters. Specifier changes confined to:
shared-edges gain one ../ (no test mocks shared modules — zero mock churn); shell↔core edges
updated with their mock ids in the SAME commit. The @vite-ignore dynamic imports in siblings.ts
keep identical relative meaning — do not touch semantically; verify:packaged-memory proves the
bundler.

## Commit order (per-commit gate: full vitest parallel + tsc + eslint 0 errors; packaged proofs
where marked)

- C0: this spec → docs/plans/core-split.md (+ precondition: W6 merged; freeze noted in the PR).
- C1 ports born + push/notification/pointer consumed in place (NO moves): ports.ts + testing.ts +
  src/main/platformPorts.ts + main.ts wiring; orchestrator drops electron Notification +
  sendToPetWindow + the pointerOverlay dynamic import; the 12 pin files swap their
  vi.mock('electron')/vi.mock('./windowRegistry')/vi.mock('./pointerOverlay') harness blocks for
  installTestPorts in beforeEach (+reset in afterEach) — ASSERTIONS BYTE-IDENTICAL (only harness
  blocks change; state that proof in the commit message). PACKAGED PROOF: npm run package +
  verify:release-artifact + verify:packaged-first-task (the push path live).
- C2 keychain port + userData parameterization: memory2 loadCipher via ports().keyWrapper;
  initOwnerId(dir)/hydrateWorkdirConfig(dir, env); main.ts passes app.getPath('userData').
  PACKAGED PROOF: npm run package + verify:packaged-memory + verify:packaged-memory-health (the
  encrypted-memory path is THE moat — this gate is non-negotiable).
- C3 boundary enforcement scaffolding: the eslint zones + the vitest boundary test, initially
  scoped to the FUTURE core dirs in place (they pass because C1/C2 removed the electron edges) —
  sabotage-verify: add a dynamic import('electron') to orchestrator.ts → the boundary test fails
  naming it → remove.
- C4 THE atomic move (git mv, one commit): all six directories + specifier/mock-id updates +
  eval-script paths + vite/forge references if any. PACKAGED PROOF: npm run package +
  verify:release-artifact + verify:packaged-memory + verify:packaged-first-task.
- C5 sweep: FactProposalView (+ any renderer-imported core types) → src/shared with the
  renderer→core zone ban; boundary test now scans src/core in its final address; lint zones final;
  grep proves zero electron references in src/core and zero core imports in renderer.
- PR gate: re-run the C4 packaged set + 3 consecutive full-suite greens (parallel vitest,
  post-move stability).

## Traps (bake in)

- Mock module-id sensitivity: ONLY shell↔core edges change ids; update vi.mock paths in the same
  commit as each edge change; grep every vi.mock literal after C4 (`grep -rn "vi.mock('" src | grep
  -v node_modules`) and prove none dangles.
- The runRegistry→sendToPetWindow hidden edge (run/runRegistry.ts line ~13).
- eval:* npm scripts reference src/brain/eval paths — update in C4.
- Never stage the node_modules symlink; chatty long commands (600s watchdog); worktree eslint
  needs --no-ignore scoped dirs.
- The COMPACTION/GC lesson from W5 applies to nothing here, but its process twin does: any test
  whose harness you touch must keep its ASSERTIONS byte-identical — if an assertion must change,
  stop and report (that's a behavior change, which this refactor forbids).
