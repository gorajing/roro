<!-- Generated 2026-06-22 by a 12-agent architecture-synthesis workflow (8 subsystem maps -> 3 lenses -> synthesis), grounded in the merged main. -->
<!-- HISTORICAL / PARTIALLY SUPERSEDED: the legacy Vapi cloud-voice path has since been DELETED, navigation/window-open hardening has landed, memory2 replaced the older memory description, and the public strategy moved to job-first/trust-first. Treat HANDOFF.md and PUBLIC.md as the living current-state docs; this file is a point-in-time architecture synthesis. -->


> **Status note:** This is a point-in-time synthesis, not the canonical current-state doc. Several findings below have
> since been addressed or reframed: the legacy Vapi cloud-voice path was deleted, navigation hardening landed
> (`isSafeNavigation`), memory2 became the durable memory spine, and the launch strategy is now job-first/trust-first. See
> `HANDOFF.md` and `PUBLIC.md` for current state.

# Roro — Architecture Synthesis

*Historical synthesis. A new senior engineer can still use this to understand many load-bearing seams, but must reconcile it against `HANDOFF.md`, `PUBLIC.md`, and the latest code before treating any claim as current.*

---

## 1. What Roro is

Roro is an open-source, local-first Electron desktop coding companion — embodied as a procedurally-drawn 16-bit pixel cat — that drives a *real* coding agent (`codex` or `claude`) in the user's chosen repo, remembers the user across sessions via owner-scoped encrypted local memory, and (later) talks. The current product thesis is a deliberate inversion of the SaaS-agent model: instead of renting intelligence behind a subscription, Roro is a companion you *own* — it runs on your machine, uses your local models or optional keys, persists a durable memory of you as its moat ("remembers-you-across-launches"), and treats monetization layers like cosmetics as future validation hypotheses rather than the v0 wedge. The cat is not a mascot bolted onto a CLI; it is the legible surface of an agent loop where every reasoning token, file edit, and shell command animates the character in real time, and where a hard safety boundary guarantees that no spoken or typed word can ever approve a destructive command.

---

## 2. The layered architecture

### Electron process model

Roro is a three-tier Electron app with a **topologically enforced** boundary, not a convention-enforced one:

- **MAIN** (`src/main/**`, plus `src/brain`, `src/memory`, `src/executor`, `src/vision`) — the trusted process with full Node access. Boots the window, owns OS capabilities (mic TCC, screen capture), holds all secrets, runs the turn loop.
- **PRELOAD** (`src/preload.ts`) — a single sandboxed bridge. It may import only `electron` and pure `shared/*` modules — *nothing that pulls in a Node builtin* (`preload.ts:5-8`). This self-imposed rule is the keystone of the security model.
- **RENDERER** (`src/renderer/**`) — sandboxed Chromium (`contextIsolation:true, sandbox:true, nodeIntegration:false`, `window.ts:47-53`). It draws the cat and wires UI, and can reach privileged capability *only* through five frozen namespaces exposed on `window` by the preload: `companion`, `brain`, `memory`, `vision`, `RORO_CFG`.

A standalone sidecar, `src/proxy/index.ts`, runs outside the Electron graph entirely: an Express server bound to `127.0.0.1` that proxies Vapi→Nebius LLM traffic, injecting `NEBIUS_API_KEY` server-side so the key never reaches the renderer.

### Layer / dependency map

Every source dependency points **downward** toward `shared/`, which is a verified zero-dependency leaf (it imports from no slice). There is no `renderer→main` or `main→renderer` *source* import — those two processes communicate only at runtime through the IPC seam.

```
RENDERER (sandboxed)  src/renderer/**  bootstrap → character/ ask/ confirm/ events/ voice/
        │ imports (types only)                    │ runtime: window.companion/brain/memory/vision
        ▼                                          ┊  (structured-clone over IPC)
shared/ (PURE LEAF)   ipc events brain memory avatar gaze pets   ◄── the ONLY cross-process surface
        ▲                                          ┊
        │ imports                  src/preload.ts  (electron + shared ONLY)
MAIN (trusted)        src/main/**  main → window mic ipc
                      orchestrator ──┬── destructive confirmGate gitTree  (3 pure safety leaves)
                          │ imports  │
                          ├──► getExecutor()            (executor/, COMPILE-TIME)
                          └~~► loadBrain/Memory/Vision  (siblings.ts, RUNTIME dynamic import)
                          ▼            ▼          ▼          ▼
PROVIDERS         executor/      brain/      memory/     vision/
                  codex claude   +Nebius     +pglite     +sharp
```

Two distinct downward arrows matter: `import` (compile-time, solid) and `~~>` (runtime-only dynamic `import()` or IPC). The orchestrator is the hub — it reaches all four providers, but imports concrete code from only one (executor); the other three arrive through runtime loaders (§5).

---

## 3. The one chokepoint: `turnRun`

Every turn — voice or typed — funnels through a single main-process entrypoint, `orchestrator.runTurn` (`orchestrator.ts:401`). This is *the* chokepoint of the system.

### The dispatch-return law

`turnRun` is an `invoke` (request/response) that resolves with nothing but a `{runId}` ticket, **after decide**, not after the work completes (`orchestrator.ts:447`). All the actual content of the turn — reasoning tokens, action events, the destructive-confirm prompt, the terminal signal — arrives asynchronously as `webContents.send` **push** events the renderer already subscribed to before dispatching. The invoke return is a correlation ticket, nearly inert by design.

This split is load-bearing, not stylistic: `invoke` is a single promise and cannot stream; a turn produces an unbounded sequence of events over potentially minutes. Push channels are the *only* way the avatar can animate *during* a run. There are exactly two transport classes, separated by structural omission — the 13 request/response channels live in `ipc.ts`; the streaming channels are registered nowhere in `ipc.ts` and are emitted exclusively from `orchestrator.ts` through `getWindow()?.webContents.send(...)` (`ipc.ts:3-5`, `orchestrator.ts:59-65`).

### The end-to-end flow of one turn

Voice and text converge *before* MAIN: neither is speech-to-speech; both hand a final transcript string to `companion.turnRun({transcript, sessionId})`. Then, walking `runTurn`:

1. **Mint + register** (`orchestrator.ts:403-405`): `runId = newRunId()`; `lastTurnId = runId`; `inFlightTurns.add(runId)`.
2. **RECALL — before store** (`orchestrator.ts:407-409`): `buildRecallContext` runs `Promise.allSettled` over `getProfile(ownerId)` (durable facts) + `recall({query, ...})` (pgvector cosine `<=>` scan), filters episodes by `similarity > 0.3`, composes facts-first. Owner-scoping is injected here via `getOwnerId()`. Recall runs *before* storing this turn's transcript so the query can't match itself. A legible `status` beat — `Memory: N known, M related` — is the first push event.
3. **STORE** the user transcript verbatim as `kind:'observation'` (`orchestrator.ts:413`), closing the self-match gap for next turn.
4. **DECIDE — streaming** (`orchestrator.ts:426`): `brain.decide(input, {onReasoning, onContent})` streams a `json_object` completion; `reasoning_content` deltas → `CH.brainReasoning`, `content` deltas → `CH.brainContent`. It returns a validated `Decision = {narration, command, args}` where `command ∈ {run_agent, answer, capture_screen, clarify}`; a hallucinated command is rejected by `parseDecision` and can never escape the brain.
5. **EXECUTE / NARRATE — `actOnDecision`** (`orchestrator.ts:456`): always persists the narration first, then branches on `command`:
   - `answer`/`clarify`: `emitNarration` + fact-extract + `runEnd` — **no executor**, which is exactly why `runEnd` is the *universal* terminal signal.
   - `capture_screen`: emit a visible one-snapshot `status` tell, wait one beat, then `vision.askScreen(... brain.describeScreen)` and re-decide *once* (guarded by `screenAlreadyCaptured`), reusing the pre-store recall to avoid self-match.
   - `run_agent`: `emitNarration` → resolve `task`/`agent` → **safety gate** (§6) → `guardedDispatch` → `dispatchExecutor`.
6. **The executor pump — `dispatchExecutor`** (`orchestrator.ts:280-395`): create `AbortController`, `activeRuns.set(runId, controller)` (Stop is now armed), `for await` over `executor.run(...)`, **re-stamp each event to the orchestrator's `runId`** (`orchestrator.ts:345`), `pushEvent → CH.actionEvent`, fire `rememberEvent` per event, and on the terminal event fire `runFactExtraction` + OS notification. `finally`: `releaseSlot` (frees the single-executor slot) + `endUi` (pushes `runEnd` exactly once).
7. **REMEMBER**: episodic writes per action plus at-most-one durable fact close the loop into turn N+1 (§4 memory, §6 supersede).

### The frozen ActionEvent union

Everything downstream of the executor speaks one vocabulary: the **11-kind** discriminated union `ActionEvent` (`events.ts:7-18`), keyed on `kind`, declared FROZEN (`status` added in C1, then re-frozen): `run.started`, `turn.started`, `reasoning`, `command`, `file_change`, `tool`, `message.delta`, `message`, `status`, `run.completed`, `run.failed`. Every event carries `runId` and `ts`. Two structural facts matter system-wide: (a) **confirm/deny is deliberately NOT a kind** (`events.ts:3-4`) — it rides a separate IPC pair, so nothing in the event stream can ever be an approval; (b) **one id per turn** — executors mint their own ids but the orchestrator re-stamps them, making `runId` the single coordinate across `activeRuns`, the confirm gate, and the renderer's Stop button.

---

## 4. Subsystem by subsystem

**Memory spine** (`src/main/identity.ts`, `src/memory/**`, `src/main/memoryContext.ts`, `src/main/factStore.ts`, `src/shared/memory.ts`). The cross-session moat. A device-stable v4 UUID `owner_id` (`identity.ts`, minted atomically via tmp+rename, throwing `OwnerCorruptError` rather than silently re-minting) scopes a single-writer PGlite+pgvector store. The store persists episodes (`action`/`narration`/`observation`) and thin profile `fact` rows, recalls episodes by cosine similarity (`recall` filters `kind <> 'fact'`), and `memoryContext.ts` composes them into a labeled `KNOWN ABOUT THIS USER` / `RELATED PAST CONTEXT` string (facts-first so truncation drops episodes, never the durable segment). `factStore.ts` serializes fact writes through a global `writeChain` and does read→insert-new→supersede-old. `MemoryKind` is a frozen union; `assertRendererMemoryKind` blocks the renderer from forging `fact` rows.

**Brain** (`src/brain/index.ts`, `src/shared/brain.ts`, `src/brain/extractFact.ts`). The LLM-facing layer over a single Nebius (OpenAI-compatible) client. `decide` is the core — it streams a validated `Decision`; `describeScreen` captions a base64 frame for the vision loop; `embed` produces the 1536-dim vectors memory depends on; `extractFact` (temp 0, off the critical path) yields at most one durable fact or null. `shared/brain.ts` is the pure contract (`Command`/`Decision`/`DecideInput`) shared across all four tiers. Narration discipline (<25 words, no code) and the run_agent-vs-capture_screen policy are *prompt-enforced only*.

**Executor** (`src/executor/**`, `src/shared/events.ts`). Drives `codex` or `claude` as a subprocess and normalizes each agent's native JSONL into the one canonical `ActionEvent` union via pure mappers, so downstream consumes identical events regardless of backend. `getExecutor(kind)` is the only branch on `AgentKind`. Ingest is tolerant (skip non-`{`, try/catch parse, unknown kinds → null, never throw); both spawn with `stdin` ignored to avoid TTY hangs; abort yields a single `run.failed{aborted}`.

**Procedural cat / avatar** (`src/renderer/character/**`, `src/shared/avatar.ts`, `src/shared/gaze.ts`). Renders either a Cubism 4 Live2D model or — since the repo ships no model — a procedurally-drawn pixel cat, behind one model-agnostic facade (`CharacterDriver`/`Avatar`). `eventToAvatarState` is the single mapper from `ActionEvent` to the frozen **6-state** union (`idle/listening/thinking/working/done/error`). Pure cores (`Activity`, `Gaze`, `framePolicy`, `cursorToGazeTarget`) take all inputs as args (including `now`) and import no Pixi/Electron, so they run anywhere and unit-test cleanly. There is deliberately **no `'talking'` state** — `setTalking` is an orthogonal boolean.

**Renderer command/event surfaces** (`src/renderer/bootstrap.ts`, `events/`, `ask/`, `confirm/`, `main/summon.ts`). Turns user intent (typed task, ⌘⇧Space, click/drag) into `turnRun` dispatches and turns MAIN's push streams back into avatar state, captions, the floating Ask/Stop pills, and the destructive-confirm chip. It owns wiring and pure UI state machines (`askReduce`, `reduceRun`, `decideSummonAction`) only — never execution, approval logic, or secrets. `subscribeActionEvents` is the central fan-out.

**Main / IPC / security boundary** (`src/main.ts`, `main/ipc.ts`, `preload.ts`, `main/window.ts`, `main/mic.ts`, `main/siblings.ts`, `shared/ipc.ts`). Boots a hardened window in ordered sequence (`initOwnerId → installPermissionHandlers → ensureMicAccess → createWindow → startCursorTracking → registerSummonShortcut`), exposes the 13 invoke channels with input narrowing (`asAgentKind`, `finitePixelDelta`), and injects `owner_id` MAIN-side so the renderer can never assert identity. `CH` (`shared/ipc.ts`) is the single channel registry both sides import.

**Voice** (`src/renderer/voice/**`). *(Updated 2026-06-24 — the legacy Vapi cloud path described in the original synthesis has been DELETED.)* A single **on-device** stack: Silero VAD (ear-perk) + whisper STT (transcribe) + Kokoro TTS (speak), composed behind the say-only `VoiceBackend` seam and the canonical `voiceTurnRouter`, gated by the `RORO_*_VOICE` dev flags (default off). It routes only *final* committed transcripts to `companion.turnRun` (mouth-not-brain); when no engine is mounted the mode is inert and only the typed path is live. Not yet speech-to-speech; partials only update captions.

**Cosmetics** (`src/renderer/voice/pets.ts`). A pure-data `-ro` pet-variant catalog (palette/roster/lookups: roro/miro/sero/taro) driving the procedural cat. Exactly one `isDefault`; `resolvePet` always returns a variant (invalid id → default). No store, no payments — foundation only, deliberately deferred pending validation.

---

## 5. The provider seams

Roro has four providers behind seams, and they are **not equally swappable** — there are three different mechanisms:

- **Memory / Brain / Vision — runtime dynamic import.** Loaded lazily through `siblings.ts` via `import(/* @vite-ignore */ '../brain/index')` against thin hand-mirrored interfaces (`BrainModule`, etc.). Swappable in principle, but the indirection exists for a *build-ordering* reason (siblings may be unbuilt), not provider abstraction. Its implementation is stringly-typed: `memory/index.ts:232` does `import('../' + 'brain')` and then string-matches the error message `'../brain'` to decide whether to fall back to Nebius embeddings (`memory/index.ts:288`). Rename the module and the classifier silently misfires.
- **Executor — compile-time.** `getExecutor` is a static `import` with a hardcoded `kind === 'claude' ? … : …` (`executor/index.ts:20-22`). Adding a backend is a code edit here, not a registration.
- **Voice — dependency injection.** The local seam is fully DI (`VoiceTurnDeps`, `VoiceBackend`) with a stub; the Vapi path is config-driven. The cleanest seam, but currently dual-implemented.
- **The LLM provider itself is *not* behind a seam at all** and is the least swappable thing in the system. `NEBIUS_BASE_URL` is hardcoded (`brain/index.ts:40`); `reasoning_content` is a Nebius-specific streaming field cast locally; `EMBEDDING_DIM=1536` is baked into *both* the brain and the memory schema (`schema.ts:23` `vector(1536)`); and the orchestrator hardcodes the provider name in user-facing narration ("DeepSeek (Nebius) is planning…", `orchestrator.ts:417-421`). Swapping LLM vendors touches the DB schema — the deepest possible coupling.

What *is* uniformly good is that each subsystem's **decision logic** is extracted into pure, injected cores (`Embedder`, `GitRunner`, `ConfirmPush`, vision's injected `describe`, the voice DI), with the heavy dependencies (LLM client, Pixi, Vapi WebRTC) pushed to the rim. The invariants live in the testable middle.

---

## 6. Cross-cutting invariants and laws — and where each is enforced

- **Owner-scoping** — *solid.* `owner_id` is injected MAIN-side at every read and write (`ipc.ts:110,120`); the renderer's `remember` type is `Omit<RememberInput,'owner_id'>` and every store query filters `owner_id` (`memory/index.ts`). Identity is unforgeable from the sandbox. Break point: the `OwnerCorruptError` last-resort re-mint silently orphans prior memory (`identity.ts:71-80`).
- **Mouth-not-brain** — facts are *derived*, never spoken; the renderer maps events to poses, never decides actions. `assertRendererMemoryKind` blocks renderer `fact` writes (`shared/memory.ts:49`); `eventToAvatarState` is the sole, read-only state mapper. In the avatar, a single LOW-priority lip-sync ticker is the only writer of `ParamMouthOpenY`.
- **Dispatch-return** — *solid.* Both `runTurn` and `runTask` resolve `{runId}` and stream over push channels; the renderer's await only acks the handoff, and the universal `onRunEnd` is the terminal signal (`bootstrap.ts:222-226`).
- **Single-executor + clean-tree (no-TOCTOU)** — *correct by construction, fragile by convention.* `guardedDispatch` refuses if `dispatchLock || activeRuns.size > 0`, and holds `dispatchLock` synchronously across `isCleanTree → preempt check → dispatch()` so no turn interleaves between "tree is clean" and "executor started" (`orchestrator.ts:107-128`). Correctness rests on the comment-asserted "registers synchronously before releasing the lock" contract plus the single-threaded event loop; a future `async` line inside a dispatch callback would silently break it with no test to catch it.
- **"No spoken word can approve rm -rf"** — *solid, structurally enforced.* Approval flows only through the dedicated `CH.confirmResolve` invoke → `resolveConfirm` (`confirmGate.ts:38`), driven by the renderer's confirm-chip Approve button — *the only code path that reaches `resolveConfirm` from user intent* (`confirmChip.ts:33-38`). The transcript only ever reaches `CH.turnRun`; these are different channels with different handlers and no edge between them. Default-DENY on 15s silence (`confirmGate.ts:29-32`); confirm/deny is structurally not an `ActionEvent` kind, so even the event stream can't smuggle approval. (The one architectural crack to watch: `narrateViaLLM`/`returnToolResult` let the Vapi LLM speak independently of `turnRun` — narration-only today.)
- **Supersede-not-overwrite** — *correct, app-level only.* `supersede` only flips a boolean; `storeFact` inserts the replacement *before* superseding every active row for the canonicalized key (self-healing), serialized via the global `writeChain` (`factStore.ts`). Break points: no DB partial-unique index enforces "≤1 active row per (owner_id, key)"; the sequence is non-transactional; `writeChain` is single-owner-only.
- **Frozen unions** — *three of them, none structurally pinned to their mirrors.* `Command` (`shared/brain.ts:2`) is duplicated in runtime `COMMANDS` and a third time in the SYSTEM_PROMPT list. `ActionEvent`'s 11 kinds are coupled to `eventToAvatarState` only by comment (the avatar mapper at least has a `never`-typed exhaustiveness guard; `COMMANDS` does not). `MemoryKind` is the cleanest — SQL filters key off the literals directly.
- **Near-zero-idle** — `framePolicy` (`framePolicy.ts`) maps state→fps: occluded→off, busy/inCall→60, drowsy→12, asleep→6. An `asleep` cat stops cursor tracking; `Activity` derives energy purely from time-since-last-poke with injected `now`. Cursor movement drives gaze only and must *not* wake the cat (`bootstrap.ts:62`), keeping idle→sleep reachable.

---

## 7. Strengths

1. **`shared/` as a pure dependency-free leaf** is the load-bearing decision. It lets the preload stay Node-free yet type-safe, lets `cursorToGazeTarget`/`eventToAvatarState` run identically in MAIN and renderer, and makes `ActionEvent` one definition consumed everywhere. Most Electron apps leak Node types into shared code and lose the sandbox; Roro doesn't.
2. **Safety encoded in topology, not in checks.** Owner-scoping (injected identity), approval (a dedicated disjoint channel, omitted from the event union), and push-vs-invoke separation are enforced by the *shape* of the system — there is no runtime check that can be forgotten.
3. **One canonical event vocabulary** behind a backend-agnostic executor seam, with narration synthesized into the same union, so the renderer handles brain output and agent output through one code path.
4. **Pure cores at the rim's interior.** The hard-to-test edges are pushed out; the invariants live in injected, unit-tested cores (`gitTree`, `confirmGate`, `factStore`, `voiceTurnRouter`, `framePolicy` all have tests).
5. **A genuinely enforced, single-file process boundary** with a unidirectional capability model and one channel registry both sides import.

---

## 8. Risks, tech-debt, and deferred work (prioritized)

**CRITICAL**
- **No navigation / window-open hardening anywhere.** A repo-wide search for `will-navigate`/`setWindowOpenHandler`/`web-contents-created` returns nothing. The renderer runs with `'unsafe-eval'` and loads remote surfaces (`*.daily.co`). If any content triggers a navigation or `window.open`, an attacker origin inherits the full `window.companion/brain/memory/vision` bridge — including `companion.runTask`, which dispatches a `workspace-write` coding agent behind only the leaky classifier. ~10-line fix; the single highest-leverage item.
- **Hardcoded developer home path** `CLAUDE_BIN = '/Users/jinchoi/.local/bin/claude'` (`claude.ts:26`) — breaks for every other user unless `RORO_CLAUDE_BIN` is set; `CODEX_BIN` is Homebrew-only. Resolve via `PATH` with env override, fail loud if unresolved.

**HIGH**
- **`connect-src 'self' https: wss:`** is wide open (`index.html:6`) — a compromised renderer can read owner-scoped memory via `window.memory.recall` and exfiltrate anywhere. Tighten to the specific origins.
- **The destructive classifier is defense-in-depth, not a sandbox.** It inspects the *task prompt string*, never the agent's argv, so paraphrase/obfuscation evades it (`find -delete`, `git push --delete`, `shred`, fork-bombs are not in `PATTERNS`), and the agent can emit `rm -rf` mid-run fully unguarded — the gate guards *intent*, not *execution*.
- **Post-Stop slot recovery still needs an operator surface.** The watchdog now ends the UI without freeing the executor slot, and the adapters escalate ignored aborts to `SIGKILL`; the slot frees only when the executor stream truly ends. If a platform child still wedges the stream, recovery is still quit-and-relaunch. Add an operator-visible force-release/diagnostic.
- **~~Two parallel, divergent voice stacks.~~ RESOLVED (2026-06-24).** The legacy `wireEvents` turn-manager was deleted with the Vapi path; `voiceTurnRouter` (`isRunActive` + barge-in queue) is now the single turn-manager for the on-device voice path. *(Original finding: the single-executor/barge-in law was implemented twice and differently, and `wireEvents` released `turnInFlight` on any `onRunEnd` rather than a run-id-matched one.)*

**MED — silent-correctness cliffs**
- **Three un-pinned frozen unions** (`Command`/`COMMANDS`/prompt; `ActionEvent`/`eventToAvatarState`) — add a compile-time exhaustiveness assertion.
- **No DB partial-unique index** for active facts — make the supersede invariant unrepresentable-if-violated.
- **Brittle `import('../' + 'brain')` string-match fallback** — rename the brain path and embeddings silently fall to network with a swallowed error.
- **Proxy swallows post-`headersSent` errors** — a truncated SSE looks like a clean end.

**Deferred / gated**
- **Hardware-gated:** local voice models (whisper.cpp/Silero/Kokoro) are interface-only scaffolding; production voice is 100% Vapi cloud + Nebius proxy. The `src/brain` local-embed half is effectively a stub (`embed?: unknown`); production silently uses network embeddings.
- **Validation-gated:** the cosmetics store, payments, and creator marketplace are intentionally absent (`pets.ts`), pending the "will devs pay?" validation. `isRoName` accepts any `[a-z]+ro` with no roster-collision check.
- **Legacy-Vapi-vs-new-voice coexistence:** the two stacks must be unified under one run-id-aware turn manager before the local seam goes live, or their gate policies race.

**UI not visually verifiable in CI**
- No model ships, so the entire Live2D path is dead/untested (`stateMachine` is hardcoded to Haru's `f01..f08`); the ~650-line `buildPlaceholder` god-function is the de-facto product. `floatingAsk`/`confirmChip` CSS visibility is "verified on-screen" — a CSS regression hiding the safety-critical Approve chip is invisible to CI. The Claude executor was never run live (no `ANTHROPIC_API_KEY`); its mapper is verified only against a hand-built sample.

---

## 9. "If you change X, beware Y" — the high-leverage / fragile seams

| If you change… | …beware |
|---|---|
| **Any line inside a `dispatch` callback in `guardedDispatch`** (`orchestrator.ts:107-128`) | Adding an `async`/`await` *before* `activeRuns.set` silently breaks the no-TOCTOU single-executor invariant. Nothing tests it. Keep registration synchronous. |
| **The `ActionEvent` union** (`shared/events.ts:7-18`) | `eventToAvatarState` couples only by comment; `check.ts`'s `default` hides new kinds. Also update `summarizeEvent` and the avatar mapper, or the cat silently stops responding to the new kind. |
| **The `Command` union** (`shared/brain.ts:2`) | Three hand-maintained copies (`COMMANDS`, SYSTEM_PROMPT); they drift with no compile-time tie. And the comment binds it to the orchestrator's `actOnDecision` dispatch — add a command and the orchestrator won't handle it. |
| **The brain module path / embed model** | `memory/index.ts:288` string-matches `'../brain'` to choose its fallback; `EMBEDDING_DIM=1536` is baked into `schema.ts:23` `vector(1536)`. Changing the embed model's dimension breaks `assertEmbedding` and inserts with no migration path. |
| **The orchestrator's `runId` re-stamp** (`orchestrator.ts:345`) | This is the single coordinate tying `activeRuns`, the confirm gate, and the renderer's Stop button. Remove it and Stop can never find the right `AbortController`. |
| **`getWindow() = getAllWindows()[0]`** (`orchestrator.ts:60`) | The entire push stream targets window[0] with `?.`. A transient-null or multi-window state silently drops *all* turn events — the renderer sees a `{runId}` that never streams or ends. |
| **The confirm channel** (`CH.confirmResolve`, `confirmChip.ts:33-38`) | This single edge is the *whole* enforcement of "no spoken word approves rm -rf." Any new path into `resolveConfirm` — or making confirm an `ActionEvent` kind — breaks the safety guarantee. The chip must stay mounted in both modes. |
| **Recall-before-store ordering** (`orchestrator.ts:407-413`) | Recall runs before the transcript is stored specifically so the query can't self-match. Reorder them and every turn's recall is polluted by its own input. The `capture_screen` re-decide reuses the pre-store recall for the same reason. |
| **The preload import rule** (`preload.ts:5-8`) | Importing anything that transitively pulls a Node builtin into the preload collapses the sandbox. The whole boundary rests on `shared/` staying a pure leaf. |
| **The `siblings.ts` thin interfaces** | They are hand-mirrored, not the real module types; `src/brain|memory|vision` can drift and fail only at runtime. Changing a provider signature won't trip the compiler. |
| **`writeChain` / fact-store concurrency** (`factStore.ts:28`) | Module-global, single-owner-only. Introduce multi-owner and the read→insert→supersede sequence races; the code itself TODOs "key the lock by ownerId." |

---

*Net: the layering is genuinely excellent — acyclic, downward-pointing, a pure leaf at the bottom, a hard topologically-enforced process boundary, and safety encoded in structure. The weaknesses cluster at two hot spots — the orchestrator's module-level concurrency state, and the provider seams (three different swap mechanisms plus one un-seamed LLM-vendor coupling that reaches into the DB schema) — plus a missing navigation lock that is the one cheap fix standing between an otherwise-airtight bridge and an untrusted origin. The contract-duplication seams are the cheapest to harden and would restore the compile-time guarantee the rest of the architecture already earns.*
