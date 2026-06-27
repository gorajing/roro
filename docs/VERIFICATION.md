# Verification

Roro has opt-in Electron smokes that observe real packaged or rendered behavior outside jsdom. The UI-launch smokes are
not in CI because they need a GUI/app launch environment, but they are the right gates when changing first-run,
memory-persistence, or floating-window UX.

## Packaged onboarding smoke

```sh
npm run verify:packaged-onboarding
```

`scripts/smoke-packaged-onboarding.mjs` launches the packaged app with disposable `HOME`, disposable working directory,
and an explicit Chromium `--user-data-dir`. It asserts the app loads from the packaged `file://...app.asar` path, the
renderer is nonblank, default v0 hides voice/mute/cosmetics and debug/direct bridges, the first-run workdir banner is
visible, the bridge reports an unset workdir, Settings can show that no project is selected, choosing a project persists
`userData/config.json`, relaunch hydrates the config, the banner stays hidden once configured, and Settings shows the
saved project.

Run this after changes to:

- `src/main/configStore.ts`
- `src/main/workdir.ts`
- `src/main/ipc.ts` workdir channels
- `src/preload.ts` workdir bridge
- `src/renderer/bootstrap/workdir*.ts`
- `src/renderer/settings/projectSettings.ts`
- `scripts/smoke-packaged-onboarding.mjs`
- packaged startup/signing/fuse behavior in `forge.config.ts` or `src/build/macSigning.ts`

## Memory/keychain health diagnostic

```sh
npx vitest run --no-file-parallelism src/memory2/keyManager.test.ts src/memory2/safeStorageWrapper.test.ts src/main/memoryHealthStatusStore.test.ts src/main/memoryHealthStartup.test.ts src/main/ipc.memory.test.ts src/preload.exposure.test.ts src/renderer/bootstrap/memoryHealthBanner.test.ts src/renderer/bootstrap.typedPrompt.test.ts src/renderer/memory/forgetPanel.test.ts
npx tsc --noEmit -p tsconfig.json
```

The memory-health diagnostic is a non-blocking startup warning path for keychain/store failures. It is separate from
`BootstrapStatusMsg`: brain readiness can block turns, but degraded memory health must not. The focused tests prove
warmup stores and pushes `checking`/`ok`/`degraded`, the renderer can recover a missed push through
`memory:healthStatusGet`, the product preload exposes only read-only health methods, the top-level banner renders
friendly local-only Keychain copy, and typed prompt submits still reach `turnRun` while memory is paused.
The Memory panel also uses the same health status to explain a Keychain-paused profile load.

After `npm run package`, run:

```sh
npm run verify:packaged-memory-health
```

`scripts/smoke-packaged-memory-health.mjs` launches the real packaged app with a smoke-only forced
`RORO_MEMORY_HEALTH_SMOKE_FAIL=keychain` failure and a fake local Ollama server. It asserts
`getMemoryHealthStatus()` returns `degraded/keychain-unavailable`, the startup banner is visible with local Keychain
copy, the Memory panel shows the same health-aware copy, and a non-memory answer turn still reaches `runEnd` without
`run.failed`. The flag is stripped from unrelated packaged smokes and is forbidden in default release verification.
The production safeStorage wrapper uses Electron's async encryption API so memory can degrade through the in-app
memory-health path instead of calling the synchronous Keychain API that can surface a native "Keychain Not Found" modal.

Run this after changes to:

- `src/main/memoryHealth*.ts`
- `src/main.ts` memory warmup wiring
- `src/main/siblings.ts` memory module loading
- `src/shared/ipc.ts` memory health channels/types
- `src/preload.ts` memory health bridge
- `src/memory2/keyManager.ts`
- `src/memory2/safeStorageWrapper.ts`
- `src/renderer/bootstrap/memoryHealthBanner.ts`
- `src/renderer/memory/forgetPanel.ts`
- `src/renderer/bootstrap.ts` banner mounting
- `src/index.css` setup banner positioning
- `scripts/smoke-packaged-memory-health.mjs`

## Destructive command tripwire

```sh
npx vitest run --no-file-parallelism src/main/destructive.test.ts src/main/orchestrator.destructiveCommand.test.ts src/main/orchestrator.stopSlotRetention.test.ts
npx tsc --noEmit -p tsconfig.json
```

Roro checks destructive tasks twice: first on the task text, where the existing confirm chip is the only approval path,
and again on started executor `command` events. The command-level tripwire aborts an unapproved destructive argv before
it is forwarded to the renderer, emits a terminal `run.failed`, and keeps the single-executor slot occupied until the
executor stream actually drains. A prompt that was explicitly approved by the confirm gate may run the matching
destructive command, subject to the existing clean-git-tree check.

Run this after changes to:

- `src/main/destructive.ts`
- `src/main/orchestrator.ts` dispatch/cancel/slot-retention behavior
- `src/executor/*.ts` command-event mapping
- `src/renderer/confirm/*`

## Packaged memory persistence smoke

```sh
npm run verify:packaged-memory
npm run verify:packaged-live-memory-turn   # optional; requires local Ollama + required models
```

`scripts/smoke-packaged-memory.mjs` launches the real packaged app with disposable `cwd` and `--user-data-dir`. On macOS
it also installs a temporary unlocked user keychain for the run, then restores the original keychain defaults; this keeps
the smoke from mutating or blocking on stale ad-hoc `Roro Safe Storage` items in the login keychain while still exercising
Electron `safeStorage`. This harness explicitly opts into `RORO_DEBUG_BRIDGE=1`, writes a unique `observation` through
the debug-only `window.memory.remember`, terminates the app, relaunches the same profile, and proves debug-only
`window.memory.recall` returns that row under the same owner. It also checks that the default memory root is
`userData/memory/memory2`, that the cwd fallback `.roro-memory2` was not created, that the memory store is marked
encrypted, and that the smoke token is not present as plaintext under the memory store.

By default this smoke forces local Ollama to an unreachable port. That makes it a deterministic persistence gate and
proves recall degrades to recency when embeddings are unavailable. `npm run verify:packaged-live-memory-turn` flips on
`RORO_PACKAGED_MEMORY_LIVE_TURN=1`: the same packaged app keeps live Ollama enabled, then after relaunch it asks
`window.companion.turnRun` about a remembered smoke value and asserts the action stream includes a memory beat and a
narration containing that value.

The live mode proves packaged same-build encrypted recall can feed a live turn/narration after relaunch. It does **not**
replace the Phase 0 non-founder magic-moment validation, the Developer-ID/notarized clean-Mac install, or cross-update
memory durability. Because the smoke seeds the value directly through the memory bridge, it also does **not** prove
natural-language extraction quality.

Run this after changes to:

- `src/main.ts` startup state initialization
- `src/memory2/index.ts`
- `src/memory2/keyManager.ts`
- `src/memory2/encryptionMode.ts`
- `src/main/ipc.ts` memory channels
- `src/preload.ts` memory bridge
- packaged startup/signing/fuse behavior in `forge.config.ts` or `src/build/macSigning.ts`

This is an engineering persistence smoke for the real `.app`. It does **not** replace the Phase 0 non-founder magic
moment validation in [`PUBLIC.md`](../PUBLIC.md), because it writes an observation directly through the memory bridge
rather than proving a complete brain-extract-recall user turn lands for a stranger.

## Developer-ID signing readiness doctor

```sh
npm run release:doctor
npm run verify:signing-readiness
```

`scripts/verify-signing-readiness.ts` is the release doctor for the human-owned Apple gate. In `release:doctor` mode it
allows the no-secret unsigned/ad-hoc path, which is why CI can run it. In strict `verify:signing-readiness` mode it
checks that the host is macOS, `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` are all present, the keychain contains a
`Developer ID Application` certificate matching `APPLE_TEAM_ID`, `xcrun` can find `notarytool` and `stapler`, and the
hardened-runtime entitlements file exists.

The strict command intentionally fails on machines where the Apple env vars are not set. Neither mode prints the
password, authenticates against Apple's notary service, produces a signed artifact, staples a ticket, or validates
Gatekeeper on a clean Mac. Those remain the `npm run make` + clean-second-Mac gates.

Before a Developer-ID `npm run make`, export the Apple variables in the current shell and run the strict doctor:

```sh
export APPLE_TEAM_ID=GNG2M47BD7
export APPLE_ID=<paid Apple ID>
export APPLE_PASSWORD=<app-specific password>
npm run verify:signing-readiness
```

After `npm run make` in that same shell, run:

```sh
npm run verify:release-artifact:dmg
npm run verify:release-artifact:signed
```

`verify:release-artifact:dmg` reuses the default release-artifact structure checks, then requires a versioned DMG under
`out/make`, verifies it with `hdiutil`, mounts it read-only, and confirms the mounted image contains a structurally
complete `Roro.app`. The default release-artifact checks intentionally fail if deferred-feature or debug-bridge flags
(`LIVE2D_MODEL_URL`, `RORO_FAKE_VOICE`, `RORO_*_VOICE`, `RORO_VOICE_PACK`, `RORO_WS5_STORE`,
`RORO_DEBUG_BRIDGE`) are set in the release shell.

When Developer-ID signing is enabled, Forge notarizes/staples the `.app` during package and the `postMake` hook
notarizes/staples the DMG container after it is created.

`verify:release-artifact:signed` additionally requires a non-ad-hoc `Developer ID Application` signature, hardened
runtime metadata, a `TeamIdentifier` (matching `APPLE_TEAM_ID` when set), a passing local Gatekeeper assessment, and a
valid stapled notarization ticket on both the packaged app and the app mounted from the DMG. It also requires the DMG
itself to pass local Gatekeeper `open` assessment and `stapler validate`. It is still not a substitute for installing the
downloaded artifact on a clean second Mac.

Run the relevant doctor before `npm run make`, then rerun the artifact verifiers after `npm run make`, when changing:

- `src/build/macSigning.ts`
- `forge.config.ts` signing/notarization config
- `build/entitlements.mac.plist`
- `scripts/verify-release-artifact.mjs`
- local Apple Developer certificate/keychain setup
- release docs that instruct the Developer-ID flow

## Full-window typed prompt + Stop

The default full-window prompt (`#prompt-form`) uses `mountTypedPrompt` for the same turn contract as
floating Ask: accepted submit disables Start, keeps the submitted draft visible, enables Stop before any
`run.started` event, and calls `cancelTask(undefined)` until `turnRun` returns the typed turn id. Once the id
is known, later Stop attempts target that id. `runEnd` is still the release signal because answer/clarify
turns may never emit `run.started`.

Fast regression coverage:

```sh
npx vitest run --no-file-parallelism src/renderer/bootstrap.typedPrompt.test.ts
npx vitest run --no-file-parallelism src/main/orchestrator.stopSlotRetention.test.ts src/executor/abortKill.test.ts
npm run verify:typed-live-turn
```

The focused test covers immediate Stop arming, no-id early cancel, late targeted recancel, stale runEnd
guarding, neutral `Stopped.` copy, workdir-cancel gating, and local-brain-not-ready gating. The packaged
onboarding and EPIPE smokes additionally assert that Stop starts disabled and stays disabled when the local
brain blocks dispatch.

The non-cooperative Stop path is unit-gated, not live-smoke-gated: `orchestrator.stopSlotRetention.test.ts`
models an aborted executor stream that stays open after the Stop watchdog has ended the UI, and proves a
second coding task is denied until the first stream truly drains. `abortKill.test.ts` covers the helper that
escalates an ignored abort from `SIGTERM` to `SIGKILL`.

`scripts/smoke-typed-live-turn.mjs` launches the default, non-floating Electron window with fake local
Ollama/Codex services and drives the real `#prompt-form` through the public `window.companion.turnRun`
bridge. It asserts the default-window DOM is visible, debug bridges are absent, Stop arms before any
`run.started`, pre-executor Stop emits scoped `run.failed: stopped` plus `runEnd`, fake Codex receives no
stopped-task invocation, the status copy stays neutral, cooperative active-executor Stop emits scoped
`run.failed: aborted` after fake Codex has emitted `run.started` and a started `file_change`, fake Codex
records `SIGTERM` without writing the aborted file, and a later answer turn recovers the form. This smoke
does not prove ignored-`SIGTERM` slot retention; the unit gate above does.

Manual full-window checklist:

| # | Action | Expected on screen |
|---|--------|--------------------|
| 1 | App boots in the default window | Start is enabled, Stop says `Stop` and is disabled |
| 2 | Submit a non-empty prompt with project + brain ready | Start disables, typed text stays visible, Stop enables immediately, status says `Thinking... click Stop if you need to pause.` |
| 3 | Click Stop before `run.started` | Stop says `Stopping...`, status says `Stopping...`, and the turn ends with neutral `Stopped.` copy |
| 4 | Click Stop after `run.started` on an active executor task | Stop says `Stopping...`, the executor is aborted, no completed file change lands, and the turn ends with neutral `Stopped.` copy |
| 5 | Submit while project selection or local brain readiness blocks dispatch | Start remains enabled, Stop remains disabled, and the draft stays in the input |

## On-screen floating Ask + Stop

The floating Ask (`#floating-ask`) and Stop pill (`#floating-stop`) carry their decision logic in pure
modules (`askMachine`, `runLifecycle`) that are unit-tested, plus a jsdom DOM shell test. Because **jsdom
has no CSS layout/visibility**, the rendered collapsed/expanded/tasked + `.armed` states must also be
checked in the running app whenever `floatingAsk.ts` or `src/index.css` changes.

Two ways to verify, below. The automated smoke is the fast path; the manual checklist is the
authoritative fallback and what to run when changing `floatingAsk.ts` or `src/index.css`.

## Automated smoke (CDP)

```sh
npm run verify:floating
npm run verify:floating-live-turn
RORO_FLOATING_LIVE_USE_REAL_OLLAMA=1 npm run verify:floating-live-turn # optional model-quality pass
```

`scripts/smoke-floating-ask.mjs` launches the real Electron renderer over the Chrome DevTools Protocol
(via the built-in `RORO_DEBUG_PORT` hook) with the renderer-only `RORO_FLOATING_SMOKE=1` lifecycle
harness. The harness injects the same `run.started` / `run.failed` / `runEnd` events the real bridge
would deliver, without starting a real coding agent or enabling the debug bridge. The smoke asserts
the rendered DOM **and computed CSS visibility**, then writes `docs/verification/floating-ask.png`.
It is opt-in (needs a display + a vite build) and not in CI. Checks: `#floating-ask` exists + starts
`collapsed`; pill reads "Ask Roro…"; `#floating-stop` exists and is not `armed`; clicking the pill →
`expanded` with the input actually visible; the memory profile bridge responds before teardown; Escape
→ `collapsed`; smoke submit → `tasked` with trimmed pill copy and visible Stop before `run.started`;
pre-run Stop calls the no-id cancel path and shows neutral `Stopped.` copy; universal `runEnd`
collapses answer/clarify turns with no `run.started`; `run.started` keeps Stop visibly armed and
targets the captured run id; real `run.failed` disarms Stop, shows actionable error copy, hides raw
spawn text, and the error remains visible after `runEnd` collapse until the next summon clears it.

`scripts/smoke-floating-live-turn.mjs` is the opt-in live counterpart. It launches the dev app in
floating mode, leaves `RORO_FLOATING_SMOKE` and `RORO_DEBUG_BRIDGE` off, drives the visible Ask form,
and verifies real `window.companion.turnRun` answer and executor turns over the public push stream.
The answer turn must emit `ActionEvent`s, reach `runEnd`, avoid the coding executor, and collapse the
floating Ask. In the deterministic fake-Ollama path, a delayed `run_agent` decision is stopped before
`run.started`; it must emit neutral stopped copy, collapse from `runEnd`, and never launch fake Codex.
The same fake path also stops a cooperative task after fake Codex has emitted `run.started` and a started
`file_change`; it must emit scoped `run.failed: aborted`, record `SIGTERM`, never emit `run.completed`,
never complete/write the aborted file, collapse from `runEnd`, and show neutral `Stopped.` copy. The
following executor success turn must launch Codex with the expected
`exec --json --skip-git-repo-check -s workspace-write -C <project>` shape, keep Stop armed for the
accepted/running turn, emit a completed `file_change` and `run.completed`, write inside the selected
test project (disposable by default), disarm Stop, and collapse from `runEnd`. By default it uses tiny
local fake Ollama and Codex servers/binaries so the product-loop proof is deterministic; set
`RORO_FLOATING_LIVE_USE_REAL_OLLAMA=1` when you specifically want to validate the local model path.
Ignored-`SIGTERM` slot retention remains covered by the unit gate above, not this live smoke. Keep it out
of CI unless the runner has a reliable display.

## Manual checklist

Start the app (`ollama serve` first if you want a real turn): `npm start`.

| # | Action | Expected on screen |
|---|--------|--------------------|
| 1 | App boots | Collapsed "Ask Roro…" pill visible; no Stop pill; cat idle |
| 2 | Click the pill (or ⌘⇧Space) | Input expands and is focused; pill chrome hidden |
| 3 | Press Enter on an **empty** input | Nothing happens — no thinking flash, stays expanded |
| 4 | Type "add a logout route" + Enter | Cat snaps to *thinking* immediately (<100ms); pill shows `tasked: add a logout route`; Stop appears before any executor event |
| 5 | While a `run_agent` turn runs | `#floating-stop` remains visible with the `armed` class |
| 6 | Click Stop | Run cancels; Stop shows `Stopping...`, then disarms/hides; Ask collapses and shows neutral `Stopped.` copy |
| 7 | An answer/clarify turn (no executor run) | Ask still collapses when the turn ends (universal `runEnd`) |
| 8 | Press Esc while expanded | Collapses back to the "Ask Roro…" pill |

A CSS regression shows up as: a state that doesn't visually change (e.g. input stays hidden when
`expanded`), the Stop pill not appearing once a task is accepted, stopped copy looking like a red
failure, or the pill text not updating to `tasked: …`.

> **Environment note:** the automated smoke needs a GUI session; it cannot run on a headless CI box.
> When verifying from a non-GUI context, use the manual checklist on a machine with a display.
