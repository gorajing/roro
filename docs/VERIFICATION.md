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
renderer is nonblank, the first-run workdir banner is visible, the bridge reports an unset workdir, Settings can show
that no project is selected, choosing a project persists `userData/config.json`, relaunch hydrates the config, the
banner stays hidden once configured, and Settings shows the saved project.

Run this after changes to:

- `src/main/configStore.ts`
- `src/main/workdir.ts`
- `src/main/ipc.ts` workdir channels
- `src/preload.ts` workdir bridge
- `src/renderer/bootstrap/workdir*.ts`
- `src/renderer/settings/projectSettings.ts`
- `scripts/smoke-packaged-onboarding.mjs`
- packaged startup/signing/fuse behavior in `forge.config.ts` or `src/build/macSigning.ts`

## Packaged memory persistence smoke

```sh
npm run verify:packaged-memory
npm run verify:packaged-live-memory-turn   # optional; requires local Ollama + required models
```

`scripts/smoke-packaged-memory.mjs` launches the real packaged app with disposable `cwd` and `--user-data-dir`. On macOS
it also installs a temporary unlocked user keychain for the run, then restores the original keychain defaults; this keeps
the smoke from mutating or blocking on stale ad-hoc `Roro Safe Storage` items in the login keychain while still exercising
Electron `safeStorage`. It writes a unique `observation` through `window.memory.remember`, terminates the app, relaunches
the same profile, and proves `window.memory.recall` returns that row under the same owner. It also checks that the default
memory root is `userData/memory/memory2`, that the cwd fallback `.roro-memory2` was not created, that the memory store is
marked encrypted, and that the smoke token is not present as plaintext under the memory store.

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
complete `Roro.app`. The default release-artifact checks intentionally fail if deferred-feature dev flags
(`LIVE2D_MODEL_URL`, `RORO_FAKE_VOICE`, `RORO_*_VOICE`, `RORO_VOICE_PACK`, `RORO_WS5_STORE`) are set in
the release shell.

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

## On-screen floating Ask + Stop

The floating Ask (`#floating-ask`) and Stop pill (`#floating-stop`) carry their decision logic in pure
modules (`askMachine`, `runLifecycle`) that are unit-tested, plus a jsdom DOM shell test. But **jsdom
has no CSS layout/visibility**, so the collapsed/expanded/tasked + `.armed` *rendering* — the part a
real user sees — has never been verified in the running app (HANDOFF §8 #2: "on-screen check owed").

Two ways to verify, below. The automated smoke is the fast path; the manual checklist is the
authoritative fallback and what to run when changing `floatingAsk.ts` or `src/index.css`.

## Automated smoke (CDP)

```sh
npm run verify:floating
```

`scripts/smoke-floating-ask.mjs` launches the real Electron renderer over the Chrome DevTools Protocol
(via the built-in `RORO_DEBUG_PORT` hook) and asserts the rendered DOM **and computed CSS
visibility**, then writes `docs/verification/floating-ask.png`. It is opt-in (needs a display + a vite
build) and not in CI. Checks: `#floating-ask` exists + starts `collapsed`; pill reads "Ask Roro…";
`#floating-stop` exists and is not `armed`; clicking the pill → `expanded` with the input actually
visible (`getComputedStyle().display !== 'none'`); Escape → `collapsed`.

## Manual checklist

Start the app (`ollama serve` first if you want a real turn): `npm start`.

| # | Action | Expected on screen |
|---|--------|--------------------|
| 1 | App boots | Collapsed "Ask Roro…" pill visible; no Stop pill; cat idle |
| 2 | Click the pill (or ⌘⇧Space) | Input expands and is focused; pill chrome hidden |
| 3 | Press Enter on an **empty** input | Nothing happens — no thinking flash, stays expanded |
| 4 | Type "add a logout route" + Enter | Cat snaps to *thinking* immediately (<100ms); pill shows `tasked: add a logout route` |
| 5 | While a `run_agent` turn runs | `#floating-stop` appears with the `armed` class (visible) |
| 6 | Click Stop | Run cancels; Stop disarms/hides; Ask collapses back to the pill |
| 7 | An answer/clarify turn (no executor run) | Ask still collapses when the turn ends (universal `runEnd`) |
| 8 | Press Esc while expanded | Collapses back to the "Ask Roro…" pill |

A CSS regression shows up as: a state that doesn't visually change (e.g. input stays hidden when
`expanded`), the Stop pill not appearing when `armed`, or the pill text not updating to `tasked: …`.

> **Environment note:** the automated smoke needs a GUI session; it cannot run on a headless CI box.
> When verifying from a non-GUI context, use the manual checklist on a machine with a display.
