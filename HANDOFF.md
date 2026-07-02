# Roro — Engineering Handoff

> **Purpose:** everything a fresh session (or a new engineer) needs to pick up Roro without re-deriving it.
> What it is, how it's built, what's done, what's broken, what we learned, and what to do next.
>
> **This supersedes the 2026-06-21 handoff** (which led with a cosmetics-first monetization idea — now reconsidered; see §1 + [`LESSONS.md`](./LESSONS.md)). **Canonical companions:** [`FOUNDING.md`](./FOUNDING.md) = identity + locked invariants + strategy of record (read it first). [`PUBLIC.md`](./PUBLIC.md) = the launch plan (Path to Public). [`README.md`](./README.md) = user-facing. [`LESSONS.md`](./LESSONS.md) = the falsified-assumptions ledger. `docs/` = current specs + the live roadmap (the stale design-history fossils were deleted 2026-07-01 — see §11 + the Rejected/superseded ledger below). When they conflict, **trust the most recent commit + this file + PUBLIC.md.**

---

## 0. TL;DR (read this, then skim the rest)

**Roro is a local-first, on-device AI desktop coding companion** — a procedural pixel cat that floats on your screen, runs a **local** Ollama brain, keeps an **encrypted, files-as-truth memory**, and dispatches a real coding **executor**. $0, no app-owned cloud/model keys, offline-default, fail-loud.

- **The product thesis:** the magic moment is **recalled memory** — after a restart, offline, the cat weaves what it remembers about how you work into its response ("I'll set up the signup route *with testing in place*"). Voice/cuteness are the frame; the recalled sentence is the payload.
- **The strategy (job-first):** lead with the **coding job** (it justifies the install + builds the daily habit); let *being known* be the emergent reward. **job → habit → memory → moat.** The moat is the per-user **encrypted on-device memory** + a **human-in-the-loop correction loop** (un-clonable, model-independent).
- **State:** the engine is strong and proven. The **biggest launch blocker is fixed** — encrypted memory now works in a packaged build (was a forge signing bug, *not* the cert). The Phase-1 packaged workdir onboarding spine landed, and the first Phase-2 correction loop slice now lets users see, fix, verify, source-check, and forget remembered facts.
- **Next:** finish the **Path to Public** in [`PUBLIC.md`](./PUBLIC.md). Cheapest next step is a **human confirmation** that a packaged build remembers across quit/relaunch; `npm run verify:packaged-memory` automates the bridge/write/relaunch/recall regression, `npm run verify:packaged-live-memory-turn` adds a live Ollama turn that speaks recalled memory, and `npm run verify:packaged-natural-memory-turn` proves a packaged natural-language teach/relaunch/recall loop, but the non-founder magic moment is still the gate. Then run `npm run verify:signing-readiness` + `npm run verify:signing-auth`, produce the Developer-ID notarized build, and run the small-cohort first-run validation.

---

## 1. The product + strategy (the current direction — reconsidered this session)

A developer's ambient coding companion shaped like a pet you bond with: you **talk or type**; it **drives a real coding agent** in your repo and **narrates the work** as the cat's body; and — the moat — it **remembers how you like to work and applies it across sessions.**

**The strategy was sharpened this session** (a 4-lens panel + a red-team skeptic):
- **NORTH STAR — "being known":** the relief of not re-explaining yourself.
- **JOB-FIRST (the red-team's correction, accepted):** "being known" is *seasoning on the coding meal*, not the meal. A companion with no job dies of "jobless cuteness." So **lead with the coding job** (which justifies the install + builds the daily habit that generates the corpus); let *being known* emerge. **The coding quality is NOT bound to the 3B brain** — the *executor* does the coding (can be as strong as you want); the local 3B only decides/extracts/narrates.
- **THE MOAT:** the per-user **encrypted, on-device memory** (a per-user switching cost, *not* an aggregate network effect — **never pool/cloud it**), deepened by a **human-in-the-loop correction loop** (user-confirmed facts are 100% true, model-independent, un-clonable).
- **ANTI-GOALS:** no cloud/accounts/telemetry; **cosmetics LAST** (a future revenue layer on the bond, *not* the product — the old handoff's "monetize via cosmetics" headline is downgraded to a deferred Phase-3+ item); no engagement dark-patterns; don't try to *beat* Cursor at raw codegen (compete on memory + privacy + continuity); encrypt-by-default + fail-loud stay.

> **Still-valid locked direction** (from the prior handoff): embodied companion, ships to developers (organic-pull retains), OSS + local-first + own-the-moat, BYO-keys + near-zero-idle (idle pet ≈ $0), voice-forward / type-default, stay on Electron (Tauri's macOS WKWebView breaks mic/screen/transparency). The launch narrative is **job-first**, not pet-first: the coding job earns the habit; the companion feeling emerges from memory and continuity.

---

## 2. Architecture

### Stack
Electron 42 + electron-forge + Vite + TypeScript + PixiJS (the cat). Vitest. Local **Ollama** brain (`qwen2.5:3b` reason/decide/extract, `qwen2.5vl:7b` vision, `nomic-embed-text` embed → 768-dim). **memory2** = encrypted files-as-truth + a derived **PGlite-HNSW** index. On-device **voice** (Silero VAD + whisper STT + Kokoro TTS) behind `RORO_*_VOICE` flags. macOS-first.

### Component map (`src/`)
| Dir | What it is |
|---|---|
| `src/main.ts` + `src/main/` | Electron **main**. `orchestrator.ts` = the **turnRun chokepoint**. `siblings.ts` = lazy brain/memory/vision loaders. `factStore.ts` = supersede-not-overwrite fact writer. `workdir.ts`, `confirmGate.ts`, `bootstrapPlan.ts`, `identity.ts` (owner_id), `memoryContext.ts`. |
| `src/brain/` | Local brain. `index.ts` (decide/extractFact/embed/describeScreen), `extractFact.ts` (marker gate + parser + value guard), `ollama.ts`, `eval/` (the **brain eval harness** + golden fixtures + `baseline.json`). |
| `src/memory2/` | Memory engine. `index.ts` (production singleton + `traceExtraction`), `memoryStore.ts` (files-as-truth + reconcile), `adapter.ts` (MemoryModule contract), `profileFacts.ts` (safe correction/source view), `keyManager.ts` (envelope encryption), `safeStorageWrapper.ts` (OS-keychain seam), `cipher.ts`, `pgliteIndex.ts`, `tracer.ts`, `memoryScore.ts` (recall blend). |
| `src/executor/` | Coding agent dispatch (edits files in `RORO_WORKDIR`). |
| `src/renderer/` | PixiJS cat + UI. `character/`, `ask/`, `memory/forgetPanel.ts`, `voice/`, `bootstrap/`, `cosmetics/`, `confirm/`, `events/bridge.ts`. |
| `src/vision/` | Screen capture + describe (sharp + vision model). |
| `src/shared/` | IPC channels + shared types (`ipc.ts`, `events.ts`, `brain.ts`, `memory.ts`). |
| `src/build/` | `macSigning.ts` — env-gated signing config + Developer-ID preflight. |
| `forge.config.ts` | Packaging: asar+unpack, extendInfo, fuses, **prePackage** (signing preflight) + **postPackage** (ad-hoc re-seal) hooks. |

### The turnRun pipeline (the chokepoint — protect it)
Every turn flows through **one** path in `orchestrator.ts`:
**RECALL** (facts via getProfile + episodes via vector recall) → **DECIDE** (brain.decide → a Command) → **EXECUTE** (executor) / **NARRATE** (cat speaks) → **REMEMBER** (rememberEvent + `runFactExtraction`). Returns `{runId}` at *dispatch* (so Stop/barge-in work); events stream over push channels (`webContents.send`; `ipcMain.handle` is request/response only).

**Fragile seams inside the chokepoint** (preserved from the deleted 2026-06-22 architecture synthesis, git `feaad68`; each verified against current code 2026-07-01):
- **`guardedDispatch` registration must stay synchronous** — it holds `dispatchLock` across clean-tree-check → preempt-check → dispatch; an `await` added before `activeRuns.set` silently breaks the no-TOCTOU single-executor invariant. Nothing tests it.
- **Recall-before-store ordering** — `recallContext` runs *before* `rememberUserSaid` stores the transcript, specifically so the query can't self-match. Reorder and every recall is polluted by its own input.
- **The `runId` re-stamp** (executors mint their own ids; the orchestrator re-stamps every event) is the single coordinate tying `activeRuns`, the confirm gate, and Stop. Remove it and Stop can't find its `AbortController`.
- **Approval is structurally not an `ActionEvent`** — confirm/deny rides the disjoint `CH.confirmResolve` IPC pair (default-DENY). Any new path into `resolveConfirm`, or making confirm an event kind, breaks "no spoken word approves `rm -rf`".
- **The preload import rule** — `src/preload.ts` may import only `electron` + pure `src/shared/*`; anything pulling a Node builtin collapses the renderer sandbox. The boundary rests on `shared/` staying a pure leaf.

### 🔒 LOCKED INVARIANTS (breaking one is an architecture regression)
1. **turnRun chokepoint** — one RECALL→DECIDE→EXECUTE→NARRATE→REMEMBER path. Hang things off it; don't fork it.
2. **Frozen `ActionEvent` union** (`src/shared/events.ts`) — consumed exhaustively (`eventToAvatarState`). Don't add variants casually.
3. **Voice is mouth-not-brain** — a say-only `VoiceBackend` seam; committed transcripts route *through* `turnRun`, never a speech-to-speech model that bypasses recall→decide→remember.
4. **Local-first / $0 / no app-owned cloud/model keys / offline-default** — no app-owned cloud accounts, telemetry, or required network for the default brain/memory path. Executor CLIs may still require their own local auth. (The old "undocumented cloud escape hatch" caveat is obsolete: the cloud-brain fork was **deleted outright** in #139 — `BRAIN_PROVIDER` now fails loud with a typed error on anything but `'ollama'`, which *strengthens* this invariant.)
5. **Fail-loud over silent-degrade** — `keyManager` throws if the keychain is unavailable; **never** stores plaintext. No `catch { return null }`.
6. **Owner-scoped memory** — every read/write scoped to `ownerId`.
7. **Files-as-truth durability** — encrypted files on disk are truth; the PGlite-HNSW index is a *derived, rebuildable cache* (reconciled on reopen). **Proven** by `crosslaunch.durability.test.ts`.
8. **Recency guarantee** — memory2 front-loads the top-2 newest episodes (recency rows carry cosine 0 → recall uses `minSimilarity: 0`; now typed via `MemoryMatch.guaranteed`, #138).

> The **one authoritative invariants list** (this one merged with ROADMAP §4's additions — point-don't-act, present ≠ watching, restraint/never-needy) lives in [`FOUNDING.md`](./FOUNDING.md).

---

## 3. What's been done (the work log — historical spine + current release track)
- **Voice (#38–#41):** on-device TTS (Kokoro) + lip-sync, barge-in, voice packs — license-clean. **(Off by default + CUT from v0.)**
- **M1 eval (#42):** the brain eval harness + `baseline.json`.
- **M2 / M2.5 (#43, #44):** fail-loud guardrails + the deterministic admission gate (`isPlausiblePreference`).
- **Vapi deleted (#48):** single on-device voice stack.
- **M5 memory (#51, #52):** `importanceFor(kind)` + repo-scoped recall (subordinate to the recency guarantee).
- **M6a CI (#53):** tsc · lint · test on every PR.
- **M7 first-run (#54, #57, #59, #60):** readiness detection + size disclosure, the model-pull engine, the one-click model-pull banner, the "Get Ollama" install-assist (guide, not auto-shell).
- **M8 transparency + Forget (#55, #56):** `memoryStore.forget` + the "🧠 What Roro knows" panel.
- **M9 (#58):** the WS5 cosmetics willingness-to-pay fake-door (stops at intent).
- **M6 signing (#61, #62):** env-gated macOS signing + a clear preflight.
- **The magic moment, observable + proven (#63):** extraction trace (`gated/noop/stored/reinforced/failed` via `RORO_TRACE`) + `crosslaunch.durability.test.ts` (proves restart + files-as-truth rebuild) + forgetPanel graceful errors.
- **Extraction value quality (#65):** stopped behavioral prefs collapsing to `"true"` (a deterministic guard + a prompt nudge + an eval value-quality axis). **20%→40%.**
- **Packaged memory FIXED (#67):** the big one — see §5.
- **Current handoff refreshed (#68):** this file became the live engineering handoff after the packaged-memory fix.
- **Packaged workdir onboarding spine (#69):** `configStore`, workdir IPC, first-run folder picker, typed/floating Ask workdir gates, ad-hoc cookie-encryption hardening, and `npm run verify:packaged-onboarding`.
- **Packaged memory persistence smoke:** `npm run verify:packaged-memory` writes/recalls an observation across full
  relaunch of the real packaged app. This proves repeatable same-build persistence, not the Phase 0 non-founder
  magic-moment gate.
- **Packaged live-memory turn smoke:** `npm run verify:packaged-live-memory-turn` requires local Ollama and observes the
  real packaged RECALL -> DECIDE -> NARRATE path speaking a bridge-seeded recalled value after relaunch. Still not a
  human, extraction-quality, cross-update, or notarized-build gate.
- **Packaged natural-memory turn smoke:** `npm run verify:packaged-natural-memory-turn` requires local Ollama and observes
  a real packaged turn learning a stated preference, writing it as a profile fact, fully relaunching, and using the
  recalled value in a later turn. Still not a human, cross-update, or notarized-build gate.
- **Opt-in real-Codex executor smoke:** `npm run verify:packaged-real-codex` keeps fake Ollama for deterministic decisions
  but uses the user's real authenticated/configured Codex CLI, proving packaged executor discovery/auth can complete a harmless file edit
  in a disposable project. This closes the local Codex-auth preflight gap; it still does not replace non-founder or
  signed/notarized clean-Mac validation.
- **Developer-ID signing readiness doctor:** `npm run verify:signing-readiness` checks macOS, Apple env shape,
  matching Developer ID Application cert, `notarytool`, `stapler`, and entitlements before `npm run make`. It does not
  replace clean-Mac Gatekeeper validation. `npm run verify:signing-auth` additionally checks Apple ID/app-specific
  password authentication with `notarytool history` without uploading an artifact. `npm run release:doctor` runs the same
  doctor in no-secret unsigned/ad-hoc mode and is wired into macOS CI.
- **Signed-artifact verifier:** after Developer-ID `npm run make`, `npm run verify:release-artifact:signed` requires a
  non-ad-hoc Developer ID signature, hardened runtime metadata, a TeamIdentifier, local Gatekeeper acceptance, and a
  valid stapled notarization ticket on the packaged app and the app mounted from the DMG; it also checks the DMG
  container's Gatekeeper `open` assessment and stapled ticket. It still does not replace the clean-Mac install.
- **DMG release artifact:** Forge now makes the macOS `.dmg`; `npm run verify:release-artifact:dmg` requires the
  versioned DMG, verifies it with `hdiutil`, mounts it read-only, and confirms it contains a structurally complete
  `Roro.app`. In Developer-ID builds, `postMake` notarizes/staples the DMG container too. This closes the
  packaging-format gap, not the signed/notarized clean-Mac gate.
- **Release/cohort guard (#128):** release-channel builds strip every deferred-v0 flag, including cosmetics, voice,
  Live2D (the flag existed then; the whole Live2D path was deleted in #140), smoke harnesses, memory-health smoke
  failure, and the privileged debug bridge; `npm run verify:release-channel`
  proves launch-time env cannot re-enable them on a release build. The canonical flag list is
  `src/shared/deferredEnvKeys.ts` (kept in sync with `scripts/v0-deferred-env.mjs` by test).
- **Showable cosmetics cleanup (#129):** the fake-door store lists only souls with an actual renderer, so Miro the dog
  is no longer presented as a cat recolor before dog art exists.
- **Memory-steered proof capture (#130):** `RORO_TRACE=1` can capture DECIDE prompt/task evidence, and
  `npm run verify:memory-steered` proves recalled memory reaches both DECIDE and `args.task` under the synthetic-marker
  proof path.
- **Floating default (#131):** Roro ships as the transparent 190x200 desktop pet by default; set
  `RORO_FLOATING_WINDOW=0` only for the legacy full dev window.
- **VoicePack catalog to shared (#137):** the voice-pack catalog moved to `src/shared/voicePacks.ts`; cosmetics no
  longer imports from `renderer/voice`.
- **Invariants encoded in types + CI (#138):** the recency guarantee is typed (`MemoryMatch.guaranteed`); the
  `KNOWN ABOUT THIS USER:` / `RELATED PAST CONTEXT:` labels are shared constants (`src/shared/memoryFormat.ts`);
  executor mapper fixtures are CI-pinned (`src/executor/fixtures.test.ts`) with a zero-activity drift tripwire; and
  `eval:brain` writes `latest.json` per run — `baseline.json` only updates via `npm run eval:brain -- --write-baseline`.
- **Cloud-brain fork deleted (#139):** the openai-SDK cloud path is gone; `BRAIN_PROVIDER` throws a typed error on
  anything but `'ollama'`. Also removed: `electron-squirrel-startup` + the non-mac makers (Squirrel/Deb/Rpm); the
  `COMPANION_CFG` fallback (the `COMPANION_*` → `RORO_*` env-var migration warning REMAINS); `siblings.ts` types are
  now derived (`Pick<typeof import(...)>`), so sibling drift is a compile error.
- **Live2D path deleted (#140):** the dependency, `public/live2d/`, and the seam are gone; Placeholder→Cat renames
  (`#cat-canvas`); CSP `'unsafe-eval'` removed (kept `'wasm-unsafe-eval'`). The procedural pixel cat **is** the
  identity, not a fallback.

---

## 4. The eval scorecard (`src/brain/eval/baseline.json`, qwen2.5:3b, temp 0 — updates only via `npm run eval:brain -- --write-baseline`; `latest.json` is the per-run scratch)
- **DECIDE 100%** (22/22) — the clarify trust gate now catches referent-less requests before the model.
- **EXTRACT (null-discipline) 100%** (10/10) — the gate holds; no profile poisoning.
- **BEHAVIORAL value-quality 40%** (2/5) — a real 2× gain (#65) **and a measured model ceiling** (the 3B is genuinely weak at describing habits; noun prefs extract cleanly). The guard guarantees no *garbage* is stored — it just sometimes stores nothing.

---

## 5. What works / what failed / open problems

**Proven (observed, not assumed):**
- The magic moment is **real** (live-tested: decide→extract→store→reopen→recall, and the brain weaves a good recalled fact into its narration).
- Memory **survives a restart on disk** (normal + files-as-truth rebuild; verified load-bearing by sabotage).
- Encrypted memory **works in a packaged build** — `codesign --verify` valid + `safeStorage` true + keychain item created, **no cert** (after #67), the packaged-memory smoke writes/recalls an observation across relaunch from the encrypted userData store, and the live packaged smoke feeds recalled memory into a real local-brain turn.

**Weak / failed / open:**
- **3B behavioral-extraction ceiling (~40%).** Fix is the **correction loop** (model-independent), **not a bigger brain.** The first loop slice is exposed in the Memory panel (`profile` / `fixFact` / `verifyFact` / `factSource` / `forget`), and the vision path now gives a bounded one-snapshot status tell before capture.
- **DECIDE clarify** — the first trust nudge is landed: referent-less requests (`fix it`, `make it better`, `update it`, `change the color`, `do that thing`) clarify before dispatch.
- **Packaged-app config / onboarding spine landed in PR #69.** Phase-1 polish is now complete: icon, brain-readiness gate, and Project Settings/change-project entry.
- **Ad-hoc cross-build memory** — the #67 fix makes a *single* build work, but ad-hoc `cdhash` changes per build → the keychain ACL doesn't survive a rebuild/update. **Developer-ID (stable team identity) is needed for update durability + a Gatekeeper-clean install.**
- **Release artifact shape:** the versioned `.dmg` artifact is generated and verified locally/CI, while Developer-ID
  notarization and clean-Mac Gatekeeper validation remain open until real Apple credentials are used.
- **App icon is real now** — `assets/roro-icon.icns` is wired through Forge; voice remains half-baked (**cut from v0**). (Live2D is no longer "half-baked" — the whole path was deleted in #140; the procedural pixel cat is the identity.)

---

## 6. Everything we learned (the lessons) → [`LESSONS.md`](./LESSONS.md)

The falsified-assumptions ledger moved **verbatim** to [`LESSONS.md`](./LESSONS.md) (2026-07-01), organized by area
(product/strategy, engineering/process, voice — including the kokoro/phonemizer GPL licensing landmine — interaction,
memory/embeddings). Add new expensive lessons there, not here.

---

## 7. The plan → see [`PUBLIC.md`](./PUBLIC.md) (authoritative)
**Definition of done:** a stranger installs a signed build (no Gatekeeper warning), runnable without a terminal, and observes a *correct* recalled fact across a full quit/relaunch.
**Phases:** **0** prove-the-moment-on-a-packaged-build (the `safeStorage` half is **DONE**; remaining = human confirmation + the Developer-ID build for Gatekeeper/durability) → **1** runnable-without-a-terminal (**landed**) → **2** trust (correction loop + clarify gate + README job/privacy framing + bounded screen-capture tell landed) → **3** debut to a small cohort, measure week-2 reopen.
**Cut from v0:** voice, cosmetics store, Windows/Linux, ambient/clipboard. (Live2D and the cloud-brain option graduated from "cut" to **deleted from the codebase** — #140 and #139 respectively.)

---

## 8. What to do next (concrete first moves)
1. **(Recommended, cheapest) Human-confirm Phase 0:** `npm run package`, `npm run verify:packaged-memory`, `npm run verify:packaged-live-memory-turn`, `npm run verify:packaged-natural-memory-turn`, then run a short non-founder/clean-profile session, **fully quit**, relaunch the *same* build, and watch it remember. The smokes prove packaged persistence, live-brain recall use, and natural-language fact extraction; the person proves the moment lands.
2. **Produce the Developer-ID notarized build:** export `APPLE_TEAM_ID=<Apple Developer Team ID>`, `APPLE_ID`, and app-specific `APPLE_PASSWORD` in the same shell, then run `npm run verify:signing-readiness`, `npm run verify:signing-auth`, `npm run make`, `npm run verify:release-artifact:dmg`, and `npm run verify:release-artifact:signed`; validate install + memory recall on a clean second Mac.
3. **Validate Phase 2 trust on real first turns:** the Memory panel can see/fix/verify/source/forget facts, referent-less requests clarify before dispatch, the README leads with the job/privacy promise, and screen reads show a bounded one-snapshot tell.

---

## 9. Founder decisions + open questions
| Decision | Status / recommendation |
|---|---|
| **Apple Developer Program + Developer ID cert** | ✅ **DONE for the maintainer** — paid-enrolled Developer ID Application cert is available locally. For Gatekeeper-clean notarized build + cross-update durability, **not** for memory to work. Build it by exporting `APPLE_TEAM_ID=<Apple Developer Team ID>`, `APPLE_ID` (paid email), and `APPLE_PASSWORD` (app-specific pw from account.apple.com → Sign-In and Security), then run `npm run verify:signing-readiness`, `npm run verify:signing-auth`, `npm run make`, `npm run verify:release-artifact:dmg`, and `npm run verify:release-artifact:signed` in that shell. |
| **Bundle id + icon** | ✅ Done: bundle id is `com.jinchoi.roro`; icon is the existing pixel cat at `assets/roro-icon.icns`. |
| **Debut channel** | Small trusted cohort first (measure week-2 reopen), not a broad post. |
| **40% behavioral ceiling: model swap?** | **No** as strategy — fix is the correction loop. Keep the brain swappable. |
| **Stated-only vs learn-from-context extraction** | Open product-identity call. |
| **Voice in v1?** | Recommend post-core. |

---

## 10. How to work in this repo (conventions)
- **TDD always** — RED (watch it fail right) → GREEN (minimal). jsdom (`// @vitest-environment jsdom`) for renderer; `mount*(): () => void` pattern; `textContent` not `innerHTML`.
- **Multi-hat adversarial review before every PR** (the in-process `Workflow` pattern). Fold *every* confirmed finding. Sabotage load-bearing tests.
- **CI / merge:** branch off `main` (never commit to main directly). **Poll `gh run view <id> --json conclusion` until `completed/*` and require `success`** before `gh pr merge <n> --merge --delete-branch`. (Don't trust `gh run watch`.)
- **Commit / PR attribution:** follow the active tool's requested attribution only when the user or workflow asks for it; do not paste stale tool-specific footers into public PRs.
- **Don't commit `.env`** (gitignored). Historical predecessor/demo checkouts are archived context only and must not be edited as part of Roro work.
- **Verify before claiming done** — "the types check" is not done; "I observed it working" is.
- **Key commands:** `npm test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npm run release:doctor` (CI-safe release/signing doctor), `npm run package` (.app), `npm run verify:floating-geometry` (default 190x200 transparent pet shell), `npm run package:release` + `npm run verify:release-channel` (release-channel deferred-flag refusal), `npm run verify:packaged-memory` (packaged write/relaunch/recall), `npm run verify:packaged-live-memory-turn` (packaged relaunch + live Ollama turn uses recalled memory), `npm run verify:packaged-natural-memory-turn` (packaged natural-language teach/relaunch/recall), `npm run verify:packaged-real-codex` (opt-in packaged first task with the user's real authenticated/configured Codex CLI), `npm run verify:memory-steered` (synthetic-marker DECIDE/args.task proof), `npm run verify:memory-panel-rendered` (opt-in local GUI smoke for rendered Memory panel keyboard/focus behavior), `npm run verify:signing-readiness` (strict Developer-ID env/cert/tool doctor), `npm run verify:signing-auth` (notarytool Apple credential auth check), `npm run make` (+ distributables + signing), `npm run verify:release-artifact:dmg` (post-make DMG verifier), `npm run verify:release-artifact:signed` (post-make signed/notarized artifact verifier), `npm start` (dev — memory works here), `OLLAMA_AVAILABLE=1 npx vitest run crosslaunch.live` (live magic-moment smoke), `npm run eval:brain` (scorecard), `EVAL_SET=behavioral npm run eval:brain`.
- **State lives in:** memory + owner.json + packaged config → `app.getPath('userData')` (override `RORO_DB_DIR`). The agent's working repo resolves from explicit `RORO_WORKDIR`, then persisted `userData/config.json`, then the explicit `RORO_ALLOW_CWD=1` dev fallback.

---

## 11. Docs (`docs/`) — current canon, fossils deleted (2026-07-01)
The stale design-history fossils were **deleted on 2026-07-01** (git history is the archive — see §12 for the ledger
with commit shas); load-bearing content was moved to [`FOUNDING.md`](./FOUNDING.md) / [`LESSONS.md`](./LESSONS.md) /
this file first. What remains in `docs/` is current: [`docs/ROADMAP.md`](./docs/ROADMAP.md) is the **live execution
plan** (defers to this file + `PUBLIC.md` for invariants and gates); `docs/INTERACTION.md` is the interaction
contract; `docs/MEMORY-ARCHITECTURE.md` / `MEMORY-RESEARCH.md` are the memory2 spec; `docs/VOICE-ARCHITECTURE.md` is
the on-device voice plan of record (cut from v0); `docs/PRODUCT_PLAN.md` is the pet/companion **vision tier**
(aspiration, not sequencing — see its banner + FOUNDING.md's strategy-of-record); `docs/strategy/` + `docs/plans/`
(paw-on-the-pixel) are the north-star thinking and the current wedge work; `docs/design/` holds saved design-asset
references (mute badges). When anything conflicts, **trust the most recent commit + FOUNDING.md + this file +
`PUBLIC.md`.**

## 12. Rejected / superseded directions (deleted docs — git history is the archive)

Recover any of these with `git show <sha>:<path>` (the sha is the file's last commit before deletion).

- **$25-Pro/cloud-sync monetization** — rejected for v0 (local-first/job-first canon) 2026-07-01, see git history (`de7cd25` `MONETIZATION.md`). Durable guardrails preserved in `LESSONS.md`.
- **"Recommended architecture" proposal (hosted tier, cross-agent MCP, MoodCore, PixiJS v8 governor)** — superseded by what was actually built 2026-07-01, see git history (`feaad68` `docs/ARCHITECTURE.md`). The "Memory API is banned positioning" insight preserved in `FOUNDING.md`/`LESSONS.md`.
- **Point-in-time architecture synthesis (pre-memory2 / pre-#139/#140 world)** — superseded 2026-07-01, see git history (`feaad68` `docs/ARCHITECTURE-SYNTHESIS.md`). Still-true fragile-seam notes preserved in §2 above.
- **Companion architecture & merge roadmap (Miro prototype, souls, ambient eye)** — superseded as a standalone doc 2026-07-01, see git history (`77b2241` `docs/COMPANION-ARCHITECTURE.md`). The souls model of record is summarized in `docs/PRODUCT_PLAN.md`'s banner; sequencing/gating lives in `docs/ROADMAP.md` §6.
- **Exploratory specs/plans of the Nebius/Vapi/Insforge/Live2D era** — superseded 2026-07-01, see git history (`11a40f4` `docs/superpowers/`). Load-bearing extracts (two-brain voice bug, interaction timing laws, embedding-geometry lesson, WS5 pre-registered gate) preserved in `LESSONS.md` + `docs/INTERACTION.md`.
- **2026 hackathon cloud-demo runbook** — superseded by the local-first path 2026-07-01, see git history (`feaad68` `docs/archive/DEMO_RUNBOOK.md`). The historical wow-moment measurement is noted in `DEMO_RUNBOOK.md`.

---

*Reflects the repo after the Phase-2 trust slices plus packaged memory/live-turn smokes, release-channel guard, memory-steered proof capture, floating-pet default, DMG release artifact, and the Developer-ID signing-readiness/signed-artifact gates. The one thing to internalize: the engine works, the packaged workdir onboarding spine is real, packaged memory now has automated write/relaunch/recall and live-brain recall-use regressions, remembered facts are user-correctable, and referent-less requests now ask before acting; the work ahead is making it **reachable and trustworthy for a stranger** — and validating, cheaply and early, every assumption the plan rests on.*
