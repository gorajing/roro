# Roro — Engineering Handoff

> **Purpose:** everything a fresh session (or a new engineer) needs to pick up Roro without re-deriving it.
> What it is, how it's built, what's done, what's broken, what we learned, and what to do next.
>
> **This supersedes the 2026-06-21 handoff** (which led with "monetized by cosmetics" — now reconsidered; see §1 + §6). **Canonical companions:** [`PUBLIC.md`](./PUBLIC.md) = the launch plan (Path to Public). [`README.md`](./README.md) = user-facing. `docs/` = deep design history (**partly stale** — predates two pivots; see §11). When they conflict, **trust the most recent commit + this file + PUBLIC.md.**

---

## 0. TL;DR (read this, then skim the rest)

**Roro is a local-first, on-device AI desktop coding companion** — a procedural pixel cat that floats on your screen, runs a **local** Ollama brain, keeps an **encrypted, files-as-truth memory**, and dispatches a real coding **executor**. $0, no keys, offline-default, fail-loud.

- **The product thesis:** the magic moment is **recalled memory** — after a restart, offline, the cat weaves what it remembers about how you work into its response ("I'll set up the signup route *with testing in place*"). Voice/cuteness are the frame; the recalled sentence is the payload.
- **The strategy (job-first):** lead with the **coding job** (it justifies the install + builds the daily habit); let *being known* be the emergent reward. **job → habit → memory → moat.** The moat is the per-user **encrypted on-device memory** + a **human-in-the-loop correction loop** (un-clonable, model-independent).
- **State:** the engine is strong and proven. The **biggest launch blocker is fixed** — encrypted memory now works in a packaged build (was a forge signing bug, *not* the cert). 30 PRs merged this session (#38–#67), 87 test files / ~548 tests, CI green on `main`.
- **Next:** finish the **Path to Public** in [`PUBLIC.md`](./PUBLIC.md). Cheapest next step is a **human confirmation** that a packaged build remembers across quit/relaunch; then build the **Phase-1 onboarding spine**.

---

## 1. The product + strategy (the current direction — reconsidered this session)

A developer's ambient coding companion shaped like a pet you bond with: you **talk or type**; it **drives a real coding agent** in your repo and **narrates the work** as the cat's body; and — the moat — it **remembers how you like to work and applies it across sessions.**

**The strategy was sharpened this session** (a 4-lens panel + a red-team skeptic):
- **NORTH STAR — "being known":** the relief of not re-explaining yourself.
- **JOB-FIRST (the red-team's correction, accepted):** "being known" is *seasoning on the coding meal*, not the meal. A companion with no job dies of "jobless cuteness." So **lead with the coding job** (which justifies the install + builds the daily habit that generates the corpus); let *being known* emerge. **The coding quality is NOT bound to the 3B brain** — the *executor* does the coding (can be as strong as you want); the local 3B only decides/extracts/narrates.
- **THE MOAT:** the per-user **encrypted, on-device memory** (a per-user switching cost, *not* an aggregate network effect — **never pool/cloud it**), deepened by a **human-in-the-loop correction loop** (user-confirmed facts are 100% true, model-independent, un-clonable).
- **ANTI-GOALS:** no cloud/accounts/telemetry; **cosmetics LAST** (a future revenue layer on the bond, *not* the product — the old handoff's "monetize via cosmetics" headline is downgraded to a deferred Phase-3+ item); no engagement dark-patterns; don't try to *beat* Cursor at raw codegen (compete on memory + privacy + continuity); encrypt-by-default + fail-loud stay.

> **Still-valid locked direction** (from the prior handoff): pet-first; ships to developers (organic-pull retains); OSS + local-first + own-the-moat; BYO-keys + near-zero-idle (idle pet ≈ $0); voice-forward / type-default; stay on Electron (Tauri's macOS WKWebView breaks mic/screen/transparency).

---

## 2. Architecture

### Stack
Electron 42 + electron-forge + Vite + TypeScript + PixiJS (the cat). Vitest. Local **Ollama** brain (`qwen2.5:3b` reason/decide/extract, `qwen2.5vl:7b` vision, `nomic-embed-text` embed → 768-dim). **memory2** = encrypted files-as-truth + a derived **PGlite-HNSW** index. On-device **voice** (Silero VAD + whisper STT + Kokoro TTS) behind `RORO_*_VOICE` flags. macOS-first.

### Component map (`src/`)
| Dir | What it is |
|---|---|
| `src/main.ts` + `src/main/` | Electron **main**. `orchestrator.ts` = the **turnRun chokepoint**. `siblings.ts` = lazy brain/memory/vision loaders. `factStore.ts` = supersede-not-overwrite fact writer. `workdir.ts`, `confirmGate.ts`, `bootstrapPlan.ts`, `identity.ts` (owner_id), `memoryContext.ts`. |
| `src/brain/` | Local brain. `index.ts` (decide/extractFact/embed/describeScreen), `extractFact.ts` (marker gate + parser + value guard), `ollama.ts`, `eval/` (the **brain eval harness** + golden fixtures + `baseline.json`). |
| `src/memory2/` | Memory engine. `index.ts` (production singleton + `traceExtraction`), `memoryStore.ts` (files-as-truth + reconcile), `adapter.ts` (MemoryModule contract), `keyManager.ts` (envelope encryption), `safeStorageWrapper.ts` (OS-keychain seam), `cipher.ts`, `pgliteIndex.ts`, `tracer.ts`, `memoryScore.ts` (recall blend). |
| `src/executor/` | Coding agent dispatch (edits files in `RORO_WORKDIR`). |
| `src/renderer/` | PixiJS cat + UI. `character/`, `ask/`, `memory/forgetPanel.ts`, `voice/`, `bootstrap/`, `cosmetics/`, `confirm/`, `events/bridge.ts`. |
| `src/vision/` | Screen capture + describe (sharp + vision model). |
| `src/shared/` | IPC channels + shared types (`ipc.ts`, `events.ts`, `brain.ts`, `memory.ts`). |
| `src/build/` | `macSigning.ts` — env-gated signing config + Developer-ID preflight. |
| `forge.config.ts` | Packaging: asar+unpack, extendInfo, fuses, **prePackage** (signing preflight) + **postPackage** (ad-hoc re-seal) hooks. |

### The turnRun pipeline (the chokepoint — protect it)
Every turn flows through **one** path in `orchestrator.ts`:
**RECALL** (facts via getProfile + episodes via vector recall) → **DECIDE** (brain.decide → a Command) → **EXECUTE** (executor) / **NARRATE** (cat speaks) → **REMEMBER** (rememberEvent + `runFactExtraction`). Returns `{runId}` at *dispatch* (so Stop/barge-in work); events stream over push channels (`webContents.send`; `ipcMain.handle` is request/response only).

### 🔒 LOCKED INVARIANTS (breaking one is an architecture regression)
1. **turnRun chokepoint** — one RECALL→DECIDE→EXECUTE→NARRATE→REMEMBER path. Hang things off it; don't fork it.
2. **Frozen `ActionEvent` union** (`src/shared/events.ts`) — consumed exhaustively (`eventToAvatarState`). Don't add variants casually.
3. **Voice is mouth-not-brain** — a say-only `VoiceBackend` seam; committed transcripts route *through* `turnRun`, never a speech-to-speech model that bypasses recall→decide→remember.
4. **Local-first / $0 / no-keys / offline-default** — no cloud/accounts/telemetry/required-network. (`BRAIN_PROVIDER=nebius` is an undocumented escape hatch only.)
5. **Fail-loud over silent-degrade** — `keyManager` throws if the keychain is unavailable; **never** stores plaintext. No `catch { return null }`.
6. **Owner-scoped memory** — every read/write scoped to `ownerId`.
7. **Files-as-truth durability** — encrypted files on disk are truth; the PGlite-HNSW index is a *derived, rebuildable cache* (reconciled on reopen). **Proven** by `crosslaunch.durability.test.ts`.
8. **Recency guarantee** — memory2 front-loads the top-2 newest episodes (recency rows carry cosine 0 → recall uses `minSimilarity: 0`).

---

## 3. What's been done (the work log — 30 PRs, #38–#67, all TDD'd + reviewed + CI-green)
- **Voice (#38–#41):** on-device TTS (Kokoro) + lip-sync, barge-in, voice packs — license-clean. **(Off by default + CUT from v0.)**
- **M1 eval (#42):** the brain eval harness + `baseline.json`.
- **M2 / M2.5 (#43, #44):** fail-loud guardrails + the deterministic admission gate (`isPlausiblePreference`).
- **Vapi deleted (#48):** single on-device voice stack.
- **M5 memory (#51, #52):** `importanceFor(kind)` + repo-scoped recall (subordinate to the recency guarantee).
- **M6a CI (#53):** tsc · lint · test on every PR.
- **M7 first-run (#54, #57, #59, #60):** readiness detection + size disclosure, the model-pull engine, the one-click download banner, the "Get Ollama" install-assist (guide, not auto-shell).
- **M8 transparency + Forget (#55, #56):** `memoryStore.forget` + the "🧠 What Roro knows" panel.
- **M9 (#58):** the WS5 cosmetics willingness-to-pay fake-door (stops at intent).
- **M6 signing (#61, #62):** env-gated macOS signing + a clear preflight.
- **The magic moment, observable + proven (#63):** extraction trace (`gated/noop/stored/reinforced/failed` via `RORO_TRACE`) + `crosslaunch.durability.test.ts` (proves restart + files-as-truth rebuild) + forgetPanel graceful errors.
- **Extraction value quality (#65):** stopped behavioral prefs collapsing to `"true"` (a deterministic guard + a prompt nudge + an eval value-quality axis). **20%→40%.**
- **Packaged memory FIXED (#67):** the big one — see §5.

---

## 4. The eval scorecard (`src/brain/eval/baseline.json`, qwen2.5:3b, temp 0)
- **DECIDE 77%** (17/22) — **clarify is the weak spot** (ambiguous requests half-run instead of asking).
- **EXTRACT (null-discipline) 100%** (10/10) — the gate holds; no profile poisoning.
- **BEHAVIORAL value-quality 40%** (2/5) — a real 2× gain (#65) **and a measured model ceiling** (the 3B is genuinely weak at describing habits; noun prefs extract cleanly). The guard guarantees no *garbage* is stored — it just sometimes stores nothing.

---

## 5. What works / what failed / open problems

**Proven (observed, not assumed):**
- The magic moment is **real** (live-tested: decide→extract→store→reopen→recall, and the brain weaves a good recalled fact into its narration).
- Memory **survives a restart on disk** (normal + files-as-truth rebuild; verified load-bearing by sabotage).
- Encrypted memory **works in a packaged build** — `codesign --verify` valid + `safeStorage` true + keychain item created, **no cert** (after #67).

**Weak / failed / open:**
- **3B behavioral-extraction ceiling (~40%).** Fix is the **correction loop** (model-independent), **not a bigger brain.** The loop is **not yet exposed to the UI** (only `profile()`/`forget()` reach the renderer; `reinforceFact`/`replaceFact`/`supersede` exist in the store, unwired).
- **DECIDE clarify (1/5)** — prompt-only fixable, not done.
- **Packaged-app config** — a packaged build doesn't read `.env`, so `RORO_WORKDIR` is unset → the executor refuses. Needs a `userData/config.json` + folder-picker. (Phase 1.)
- **Ad-hoc cross-build memory** — the #67 fix makes a *single* build work, but ad-hoc `cdhash` changes per build → the keychain ACL doesn't survive a rebuild/update. **Developer-ID (stable team identity) is needed for update durability + a Gatekeeper-clean install.**
- **No first-run onboarding gate;** default bundle id / no icon; voice + Live2D half-baked (**cut from v0**).

---

## 6. Everything we learned (the lessons)

**Product / strategy:** the magic moment is the recalled memory, not the voice. **Job-first, not feeling-first** (the skeptic's correction): a companion needs a real job; memory makes *that job* stickier. The cert is for *distribution + durability*, NOT for making memory work. The cosmetics-as-monetization headline (old handoff) is downgraded — cosmetics are a deferred Phase-3+ layer on the bond, never the wedge.

**Engineering / process (hard-won):**
- **Test the riskiest assumption *cheapest* and *first*.** The whole PUBLIC.md keystone rested on "a signed build fixes memory." A ~10-min, $0 test (a minimal ad-hoc app) **falsified** it before we built on it. Real cause: **forge ships an invalid signature** — the FusesPlugin fuse-flip + the `extendInfo` (`NSMicrophoneUsageDescription`, *we added* in #61) rewrite `Info.plist` *after* the seal → `errSecAuthFailed` → `safeStorage` false. Fixed by a **postPackage ad-hoc re-seal** as the last step.
- **A green local suite can lie** — a `void`-dispatched unhandled rejection (extending `MemoryModule` broke 4 hand-rolled orchestrator mocks) was green locally, red on CI. *Grep for all mocks when extending a shared interface.*
- **`gh run watch --exit-status` lies** — it returned 0 while the run *failed*; we merged a red PR. *Poll `gh run view <id> --json conclusion` until `completed/*` and require `success` before merging.*
- **A green test can prove nothing** — the first durability test passed spuriously (warm index, never reconcile-from-files). *Sabotage a load-bearing test to prove it'd fail.*
- **An eval metric can be dead-on-arrival** — the `bare_boolean` mode was unreachable (the guard nulls `"true"` first). *Separate "protect production" (guard) from "measure the model" (eval).*
- **macOS gotchas:** `codesign` with a real cert pops a keychain prompt that *hangs* a non-interactive shell (use ad-hoc `--sign -` for local tests). The keychain ACL is **cdhash-pinned** for ad-hoc. `safeStorage` works in `npm start` + any *validly*-signed build.
- **Codex review is unreliable here** (`codex exec` hung twice; orphan process — `pkill -9 -f "codex exec"`). We use **in-process multi-hat Workflow reviews** (parallel reviewers per dimension → per-finding adversarial verify) — every one caught a real bug.

---

## 7. The plan → see [`PUBLIC.md`](./PUBLIC.md) (authoritative)
**Definition of done:** a stranger installs a signed build (no Gatekeeper warning), runnable without a terminal, and observes a *correct* recalled fact across a full quit/relaunch.
**Phases:** **0** prove-the-moment-on-a-packaged-build (the `safeStorage` half is **DONE**; remaining = human confirmation + the Developer-ID build for Gatekeeper/durability) → **1** runnable-without-a-terminal (configStore + folder-picker + readiness gate + bundle id/icon — *all buildable now, no cert*) → **2** trust (expose the **correction loop** + clarify nudge + README job+privacy-first + screen-capture tell) → **3** debut to a small cohort, measure week-2 reopen.
**Cut from v0:** voice, Live2D, cosmetics store, Windows/Linux, the cloud-brain option, ambient/clipboard.

---

## 8. What to do next (concrete first moves)
1. **(Recommended, cheapest) Human-confirm Phase 0:** `npm run package`, short session, **fully quit**, relaunch the *same* build, watch it remember. Unblocked, no cert.
2. **Build the Phase-1 spine** (no cert; memory-independent): `userData/config.json` for `RORO_WORKDIR` (mirror `identity.ts`); a first-run native folder-picker; gate the first turn on the existing `bootstrapBanner` readiness; branded `appBundleId` (`com.jinchoi.roro`) + icon.
3. **Phase 2** (after Phase 0 human-confirmed): expose the **correction loop** (`reinforceFact`/`replaceFact`/`supersede` over IPC + a "fix this" UI) — the strategy's #1 moat + the real fix for the 40% ceiling. Plus the DECIDE clarify few-shot.

---

## 9. Founder decisions + open questions
| Decision | Status / recommendation |
|---|---|
| **Apple Developer Program + Developer ID cert** | ✅ **DONE** — paid-enrolled; `Developer ID Application: Jin Young Choi (GNG2M47BD7)` in the keychain (intermediate CA present). For Gatekeeper-clean notarized build + cross-update durability, **not** for memory to work. Build it: `APPLE_TEAM_ID=GNG2M47BD7` + `APPLE_ID` (paid email) + `APPLE_PASSWORD` (app-specific pw from account.apple.com → Sign-In and Security) + `npm run make`. |
| **Bundle id + icon** | Recommend `com.jinchoi.roro` + the existing pixel cat at 1024px → `.icns`. Founder call. |
| **Debut channel** | Small trusted cohort first (measure week-2 reopen), not a broad post. |
| **40% behavioral ceiling: model swap?** | **No** as strategy — fix is the correction loop. Keep the brain swappable. |
| **Stated-only vs learn-from-context extraction** | Open product-identity call. |
| **Voice in v1?** | Recommend post-core. |

---

## 10. How to work in this repo (conventions)
- **TDD always** — RED (watch it fail right) → GREEN (minimal). jsdom (`// @vitest-environment jsdom`) for renderer; `mount*(): () => void` pattern; `textContent` not `innerHTML`.
- **Multi-hat adversarial review before every PR** (the in-process `Workflow` pattern). Fold *every* confirmed finding. Sabotage load-bearing tests.
- **CI / merge:** branch off `main` (never commit to main directly). **Poll `gh run view <id> --json conclusion` until `completed/*` and require `success`** before `gh pr merge <n> --merge --delete-branch`. (Don't trust `gh run watch`.)
- **Commit footer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: <url>`. **PR footer:** `🤖 Generated with [Claude Code]` + the session URL.
- **Don't commit `.env`** (gitignored). The **frozen `gorajing/companion` repo** must not be touched.
- **Verify before claiming done** — "the types check" is not done; "I observed it working" is.
- **Key commands:** `npm test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npm run package` (.app), `npm run make` (+ distributables + signing), `npm start` (dev — memory works here), `OLLAMA_AVAILABLE=1 npx vitest run crosslaunch.live` (live magic-moment smoke), `npm run eval:brain` (scorecard), `EVAL_SET=behavioral npm run eval:brain`.
- **State lives in:** memory + owner.json → `app.getPath('userData')` (override `RORO_DB_DIR`). The agent's working repo → `RORO_WORKDIR` (`~/Code/roro-workspace` in the user's `.env`).

---

## 11. Design docs (`docs/`) — deep reasoning, PARTLY STALE
`docs/` holds the original design history (the "v2 spine" UX proposal is still the canonical *interaction* model; `docs/MEMORY-ARCHITECTURE.md` / `MEMORY-RESEARCH.md` are the memory2 spec). **But several docs predate two pivots:** (1) the memory2 rebuild, and (2) this session's **job-first strategy reframe** (which downgrades the old "cosmetics monetization" headline). `MONETIZATION.md` (the rejected $25-sync model) is superseded. **Trust this file + `PUBLIC.md` + the latest commit over `docs/`.**

---

*Reflects the repo at PR #67 (main green). The one thing to internalize: the engine works and the magic moment is real + proven; the work ahead is making it **reachable and trustworthy for a stranger** — and validating, cheaply and early, every assumption the plan rests on.*
