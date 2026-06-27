# Roro — Path to Public

> The plan to take Roro from "works on my machine" to a trustworthy first impression in a stranger's hands.
> Synthesized from a 4-lens strategy panel + a 4-dimension public-readiness audit (see git history of this file).

---

## What Roro is (the v0 identity)

**The private, local coding companion that remembers how *you* work.**

Lead with the **job** (a real coding executor that gets better at your patterns over time); let *being known* be the
emergent reward of using it daily — not the pitch. The single feeling to engineer for is **"being known"**: the quiet
relief of not having to re-explain yourself.

- **North star:** opening your laptop feels like being greeted by something that remembers how you work.
- **The moat:** the per-user, **encrypted, on-device** memory — a switching cost, not a network effect — deepened by a
  human-in-the-loop **correction loop** (a user-confirmed fact is 100% true, model-independent, and impossible to clone).
- **Sequence:** job → habit → memory → moat. The job earns the daily open; the daily open builds the corpus; the corpus
  is the moat. Don't try to summon the moat before the job exists.

---

## ⭐ The keystone (read this first)

Every public-readiness assessor independently flagged the **same** #1 risk, and it has a nasty property: **it is
invisible in `npm start` and only appears in a packaged build in a stranger's hands.**

The magic moment (recalled memory) depends on `safeStorage` reaching the macOS Keychain.

> ✅ **ROOT CAUSE FOUND + FIXED (proven on-device, not assumed).** The original diagnosis ("ad-hoc *cannot* reach the
> Keychain") was **wrong**. A *valid* ad-hoc signature works fine. The real cause: forge's fuse-flip + the `extendInfo`
> `Info.plist` rewrite left the packaged app with an **INVALID signature** → macOS Keychain returned `errSecAuthFailed`
> → `safeStorage` false → memory failed. (Ironically, the `NSMicrophoneUsageDescription` `extendInfo` added for signing
> in PR #61 is what exposed it.) **Fix:** a `postPackage` ad-hoc re-seal as the last step (`fix/packaged-memory-adhoc-reseal`).
> Verified: a clean `npm run package` now yields `codesign --verify` VALID + `safeStorage.isEncryptionAvailable()=true` +
> the keychain item is created — **with NO Apple cert.**

So the keystone is **answered, and it was free.** Encrypted memory persists in a packaged build **today**, no cert
required. The **two roles of the Developer-ID cert are now clear and separate:**

1. **Gatekeeper-clean install** on a stranger's downloaded build (notarization) — still required for public distribution.
2. **Cross-update memory durability** — an ad-hoc `cdhash` changes every build, so its keychain ACL only matches *that*
   build (memory survives quit/relaunch, but an **update** orphans the prior corpus). A Developer-ID's **stable team
   identity** is what makes the keychain item survive updates. So the cert is for *distribution + longevity*, **not** for
   making memory work at all.

> Phase 0's safeStorage half is **done**. What remains for Phase 0 is the *human* confirmation (a non-founder uses a
> build and feels it remember) + the Developer-ID build for the Gatekeeper/longevity half. Encrypt-by-default is intact —
> `keyManager` still fails loud; we did **not** add a plaintext fallback.
> Automated preflight: `npm run verify:packaged-memory` now launches the real packaged app, writes an observation through
> the memory bridge, quits, relaunches, and recalls it from the encrypted `userData` store. This strengthens the packaged
> persistence evidence, but it does **not** replace the non-founder magic-moment test.
> Live-brain preflight: `npm run verify:packaged-live-memory-turn` requires local Ollama and proves the packaged
> RECALL → DECIDE → NARRATE path can speak a bridge-seeded recalled value after relaunch. This narrows the engineering
> risk, but still is not natural-language extraction proof, Developer-ID/notarized clean-Mac validation, or non-founder
> validation.
> Natural-language preflight: `npm run verify:packaged-natural-memory-turn` also requires local Ollama and proves a real
> packaged turn can learn a plainly stated preference, write it as a profile fact, fully relaunch, and use that fact in a
> later turn. This narrows the extraction-quality engineering risk; it still does not replace the signed/notarized
> clean-Mac gate or the non-founder "does this feel correct and useful?" test.
> First-task preflight: `npm run verify:packaged-first-task` launches the real packaged app with persisted project
> config, deterministic fake Ollama, a fake Codex override, and the product preload bridge. It proves the default typed
> surface exposes the executor-readiness check, then can complete a first coding task through public `turnRun` and Codex
> events. It still does not replace real Codex auth, signed/notarized clean-Mac validation, or non-founder validation.

---

## ✅ Definition of done (the go/no-go gate)

Roro is public-ready when **all** of these are observed (not code-read):

- [ ] A stranger downloads a Developer-ID-**signed + notarized** `.dmg` and launches it with **zero Gatekeeper warnings**
      (no right-click→Open dance). Verified on a **clean second Mac**, not the build box.
- [ ] The packaged app is runnable **without a terminal**: a native folder-picker sets the working repo, honest
      Ollama/model status with guided Ollama install + one-click model pull — no `.env`, no app-owned model API keys,
      no shell for the Roro setup path. Executor CLIs may still require their own local auth, separate from Roro's
      brain/model key promise.
- [ ] The chosen working repo persists in `userData/config.json` and survives relaunch; the executor never throws
      "Roro has no working repo set" for a user who completed onboarding. `RORO_WORKDIR` remains an explicit env override.
- [ ] **The heart:** on the signed build, a fact stored in session 1 is recalled in session 2 after a **full quit +
      relaunch** — `safeStorage.isEncryptionAvailable()` is true, the AES-256-GCM envelope round-trips.
- [ ] **A non-founder** observes the magic moment: types a task, Roro recalls a prior fact and uses it, and the recall
      is **correct** (not `- true` garbage).
- [ ] Branded bundle ID (not `com.github.Electron`) + a real app icon (the pixel cat) in Dock/Launchpad.
- [ ] Brain-not-ready and executor-can't-run failures are **loud + actionable in-UI** — never a silent empty window or a
      mid-task surprise or a raw env-var error string.
- [x] README leads with the **job + a 3-sentence privacy promise** (local brain/memory, encrypted-by-default, no
      app-owned telemetry) — not a feature list of face/voice/memory.
- [ ] **Nothing half-baked ships:** voice and Live2D are either fully working behind onboarding *or* fully hidden (no
      dead "relaunch with RORO_STT_VOICE=1" hints). A stranger sees nothing they can't actually use.

---

## The path (riskiest truth validated first, not last)

### Phase 0 — Prove the magic moment survives a packaged build (the keystone)
**Status: the safeStorage half is DONE.** The packaged-build memory failure was a forge invalid-signature bug, fixed by
the postPackage ad-hoc re-seal (`fix/packaged-memory-adhoc-reseal`). A clean `npm run package` is now `codesign --verify`
VALID + `safeStorage.isEncryptionAvailable()=true` + creates its keychain item — **no cert.** What remains:
- ✅ **Automated same-build persistence smoke:** `npm run verify:packaged-memory` writes and recalls an observation
  across full process termination/relaunch of the real packaged app. This covers repeatable engineering persistence
  only; Phase 0 still exits on human confirmation plus the Developer-ID/Gatekeeper path below.
- ✅ **Live packaged turn smoke:** `npm run verify:packaged-live-memory-turn` keeps local Ollama enabled and asserts a
  packaged relaunch feeds recalled memory into `turnRun` narration. It is a stronger local preflight, not a replacement
  for the human, extraction-quality, or notarized-build gates.
- ✅ **Natural-language packaged turn smoke:** `npm run verify:packaged-natural-memory-turn` keeps local Ollama enabled,
  teaches a stated preference through the packaged `turnRun` path, waits for a profile fact sourced to that teach
  session, fully relaunches, and asserts a later turn narrates the remembered value. It is still not the non-founder or
  signed/notarized clean-Mac gate.
- **Human confirmation (the real Phase-0 exit):** a non-founder runs a build, has a short session, **fully quits**,
  relaunches the **same build**, and observes the fact recalled. (Within-build quit/relaunch works under ad-hoc; this is
  doable today without the cert.)
- **The Developer-ID + notarized build** (cert is present locally; `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`; the
  `macSigningConfig` + `entitlements.mac.plist` + notarytool pipeline is wired). This is for **(a)** a Gatekeeper-clean
  install on a clean second Mac and **(b)** memory durability **across updates** (stable team identity vs. per-build
  ad-hoc cdhash) — *not* for making memory work at all.
  Run `npm run verify:signing-readiness` after exporting the Apple env vars and before `npm run make`; it checks local
  cert/tool/env readiness. Run `npm run verify:signing-auth` to check the Apple ID/app-specific password against
  `notarytool history` without uploading an artifact. Neither command replaces clean-Mac Gatekeeper behavior. With those
  env vars present, `npm run make` signs/notarizes the app and notarizes/staples the DMG container. After `npm run make`, run
  `npm run verify:release-artifact:dmg` and `npm run verify:release-artifact:signed` before the clean-Mac install.

**Exit:** a non-founder observes a fact recalled across a full quit/relaunch of a packaged build (proves the moment works
outside `npm start`); and the Developer-ID notarized build installs Gatekeeper-clean on a clean Mac.

### Phase 1 — Make the packaged app runnable without a terminal (the onboarding spine)
**Status: LANDED.** The packaged app now has a persisted workdir spine:
`configStore`, `config:get`, `config:chooseWorkdir`, `workdirBanner`, typed/floating Ask gates via
`ensureWorkdirReady`, and `npm run verify:packaged-onboarding`. The app no longer depends on a terminal `.env` path for
the happy packaged first-run workdir flow.

**Goal:** take a stranger from launch → a successful coding turn, no shell. *(All memory-architecture-independent.)*
- ✅ `userData/config.json` read/write for the working repo; `resolveWorkdir` honors explicit env first, then persisted
  config, then the explicit `RORO_ALLOW_CWD=1` dev fallback.
- ✅ First-run flow: no workdir → native folder-picker ("Which project should Roro work on?") → persist; typed and floating
  tasks are gated until a project exists.
- ✅ Raw "Roro has no working repo set" is no longer the normal user path; the UI asks for a project before dispatch.
- ✅ Branded `appBundleId` is set in `forge.config.ts` (`com.jinchoi.roro`).
- ✅ Real app icon in Dock/Launchpad: `assets/roro-icon.icns` from the 1024px pixel-cat PNG.
- ✅ Stronger brain-readiness gate: typed and floating Ask block a coding turn when the startup preflight reports
  Ollama/models are not ready.
- ✅ Project control in Settings: after first setup, the user can see the active repo and change the saved project
  without relaunching; `RORO_WORKDIR` remains an explicit read-only override.
- ✅ Packaged first-task preflight: `npm run verify:packaged-first-task` proves the persisted project, local-brain
  readiness, public selected-executor readiness bridge, and public `turnRun` path can produce a file change in the chosen
  repo without debug bridges.

**Exit:** a stranger who has never touched a terminal launches → is guided to pick a repo → sees honest model status with
guided Ollama install + one-click model pull → types a task the executor runs to completion with any executor CLI auth
already handled. Dock shows the cat icon.

### Phase 2 — Trust the first impression (correctness + honest framing)
**Goal:** make the moment *land* and feel trustworthy, not lucky. *(Correction loop is memory-dependent — do it after
Phase 0 confirms memory persists signed.)*
- ✅ **Expose the correction loop** (the moat): the Memory panel now calls MAIN-owned `profile`, `fixFact`, `verifyFact`,
  `factSource`, and `forget`, so a remembered fact can be **corrected/verified/source-checked**, not only deleted.
  Privacy *with* agency.
- See [`docs/PHASE2-TRUST-LOOP.md`](./docs/PHASE2-TRUST-LOOP.md) for the build contract: correction lives in the existing
  Memory panel, MAIN owns owner-scope validation and fact-key lookup, and the renderer never supplies trusted fact keys.
- Never recall a `- true` / bare-boolean line (the guard prevents storage; ensure recall never surfaces noise).
- ✅ Nudge DECIDE toward **clarify** on referent-less requests ("fix it", "make it better") via a deterministic pre-model
  trust gate plus prompt guidance. Live eval now has all clarify rows passing without concrete-task regressions.
- ✅ Rewrite the README to lead with the **job + privacy promise** + a `RORO_WORKDIR` troubleshooting line.
- ✅ Show a visible **"Taking one screen snapshot."** status tell before the first on-demand vision capture (the
  creepy↔care line, framed as a bounded snapshot instead of ongoing watching).

**Exit:** a stranger's first turn lands a *correct* recalled fact or honestly asks to clarify (never a confident wrong
guess); a wrong fact is fixable in-UI in one action; the README describes the job + privacy, not a feature list.

### Phase 3 — Debut to a small, honest audience and measure attachment
**Goal:** learn the only thing that matters — does the moment land for people who aren't you, and do they come back?
- **Channel (founder decision):** a small trusted cohort (friends + one AI/dev community) over a broad post — narrow
  enough to watch every first-run.
- Ask each tester three things: (1) did the magic moment land? (2) onboarding/`RORO_WORKDIR` friction? (3) will you reopen
  it next week?
- Capture `RORO_TRACE` from real first turns to seed the eval with real ambiguous requests (today's fixtures are synthetic).
- Triage: any first-run blocker is a same-day fix; cosmetic/feature requests go to the post-public backlog.

**Exit:** a majority of the cohort reaches the magic moment unaided on the signed build **and at least some reopen a
second day.** Real traces captured; showstoppers fixed.

---

## ✂️ Not for v0 (the discipline)

v0 is **one thing done well: the remembering coding companion.** Deliberately cut:

- **Voice (STT/VAD/TTS)** — heavy, behind dev flags, the riskiest on-device surface. Ship OFF and **hidden** (remove the
  dead "relaunch with RORO_STT_VOICE=1" hint).
- **Live2D avatar** — the procedural pixel cat is charming + complete; it *is* the v0 identity. A half-integrated model
  deepens the "unfinished" impression.
- **Cosmetics store / pet variants** (WS5) — code-complete but fake-door. Monetization is post-PMF; validating the moment
  comes first.
- **Windows / Linux** — the whole trust stack (hardened runtime, notarization, `safeStorage`) is macOS-first and proven
  there. Port after the macOS moment is validated.
- **Cloud-brain option** (`BRAIN_PROVIDER=nebius`) — works in code, but adds an API-key path and dilutes the
  local-first promise. Keep it out of the default quickstart and launch story; leave it as an explicit power-user env var.
- **Ambient / clipboard proactivity** ("I notice you copied an error") — raises consent/creepiness stakes before basic
  trust is established. Wrong order.

---

## 🔑 Founder decisions

| Decision | Recommendation |
|---|---|
| **Apple Developer Program + Developer ID cert** | ✅ **Done locally** (`Developer ID Application: Jin Young Choi (GNG2M47BD7)`). Next: export `APPLE_TEAM_ID=GNG2M47BD7`, `APPLE_ID`, and an app-specific `APPLE_PASSWORD`, run `npm run verify:signing-readiness && npm run verify:signing-auth && npm run make && npm run verify:release-artifact:dmg && npm run verify:release-artifact:signed`, then validate the notarized build on a clean Mac. |
| **Bundle ID + icon** | ✅ Done: bundle ID is `com.jinchoi.roro`; Dock/Launchpad icon is the black pixel cat at `assets/roro-icon.icns`, generated from the 1024px source PNG. Keep this identity; don't design a new brand. |
| **`RORO_WORKDIR` setup UX** | A mandatory first-launch native folder-picker (the gate between "launched" and "can code") + a Project control to change the saved repo later. |
| **Debut channel** | A small trusted cohort first — measure attachment (does the moment land, do they reopen), not vanity downloads. Broaden only after it lands for strangers. |
| **The go/no-go bar** | Phase 0's exit, hardened: a non-founder, clean Mac, signed `.dmg`, fact recalled across a full quit. If that one thing isn't true, **nothing ships.** |

---

## 🚨 Biggest risk

The magic moment (encrypted memory recall) **not surviving** the jump from `npm start` to a signed packaged build. It's
invisible in development and only manifests in a stranger's hands; if it fails, the entire "being known" moat silently
evaporates. The plan front-loads it as **Phase 0** — now gated on the notarized `make` credentials and clean-Mac
validation, provable in an afternoon.

## The first thing to do

**Preflight packaged memory (`npm run package && npm run verify:packaged-memory && npm run verify:packaged-live-memory-turn && npm run verify:packaged-natural-memory-turn`),
then preflight signing (`npm run verify:signing-readiness` + `npm run verify:signing-auth`) and produce the first
Developer-ID signed + notarized build** to test on a clean second Mac:

```sh
export APPLE_TEAM_ID=GNG2M47BD7
export APPLE_ID=<paid Apple ID>
export APPLE_PASSWORD=<app-specific password>
npm run verify:signing-readiness
npm run verify:signing-auth
npm run make
npm run verify:release-artifact:dmg
npm run verify:release-artifact:signed
```

The signed clean-Mac path is the final public gate. Before Apple credentials are set, the packaged smokes and a
same-build human rehearsal still matter: they validate the core memory moment cheaply while the signed/notarized install
and cross-update durability gates remain open. Phase 2 from [`docs/PHASE2-TRUST-LOOP.md`](./docs/PHASE2-TRUST-LOOP.md)
is already landed: correction, clarify, README framing, and the bounded screen-capture tell.
