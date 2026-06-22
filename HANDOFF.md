# Roro — Project Handoff & Source of Truth

> **Read this first.** This is the canonical, reconciled direction as of 2026-06-21. The dated design docs under `docs/` hold the deep reasoning, but **where any of them conflicts with this doc, this doc wins** (the project pivoted late in the design phase; several docs predate the pivot — see §9).

---

## 0. TL;DR for the next agent

**Roro** is a cute pixel-cat desktop pet that **drives your coding agent** (Codex/Claude Code, on *your* keys), **remembers you across sessions**, and **talks** — built **free + local-first**, monetized by **cosmetics** (alternate pets, items, voice packs), *not* subscriptions.

- **Repo:** `/Users/jinchoi/Code/roro` — private `github.com/gorajing/roro`, branch `main`. Builds clean (`tsc` 0 errors), `npm test` = 61/61 green. Fresh git history.
- **It's a fresh start** copied from a hackathon prototype's verified bones (procedural cat, executor adapter, orchestrator, frozen ActionEvent union, Vitest) + all design docs, renamed Nero→Roro. The old hackathon repo (`/Users/jinchoi/Code/companion/app`, remote `gorajing/companion`) is **frozen — do not touch it**.
- **A.5 — the memory spine — is DONE** (branch `feat/a5-memory-spine`): device-stable `owner_id`, local PGlite + pgvector store (re-authored from Insforge), owner-scoped recall + `getProfile`/supersede, the 1-fact extractor, and supersede-not-overwrite — proven by an automated cross-launch persistence test (teach → close → reopen → recall) and hardened through a 7-round Codex cross-model review. **The ONE next task is now Phase B — the magic moment** (see §8).
- **How to work:** TDD with Vitest (red→green), small diffs, run `npx tsc --noEmit` + `npx vitest run` to verify. Ground in the actual files before editing.

---

## 1. What Roro is

A developer's ambient coding companion in the shape of a pet you bond with. You **talk or type** to it; it **drives a real coding agent** in your repo and **narrates the work** as the cat's body language (every read/edit/command shown live); and — the moat — it **remembers how you like to work and applies it across sessions**. Cuteness is the wrapper, competence is the hook, **memory is why you keep it installed**, and **cosmetics are how it makes money**.

**The magic moment:** after a full app restart (same device-stable `owner_id`, fresh session), you say/type *"add a logout route,"* and before the work finishes the cat says, unprompted, *"On it — and like last time I'll add a test alongside it."* No account, all local. That recalled sentence is the whole product thesis.

## 2. Locked direction (don't re-litigate)

- **Pet-first.** The relationship is the product; coding is the killer trick. Soul = **Personality × Memory → Growth**. **No guilt/Tamagotchi mechanics** — absence is always free.
- **Ships to developers.** Organic-pull audience (retains through corrections).
- **OSS + local-first + own-the-moat.** Commodity the substrate (brain/voice/DB are swappable behind seams); the moat is the **typed, per-user "knows-you" memory**. The moat is **per-user switching cost**, NOT an aggregate data network effect.
- **BYO-keys + near-zero-idle.** The user brings their own model/agent keys; an idle pet costs ~$0 (no always-on mic/vision/compute). These two laws are why the free tier costs the team ~$0.
- **Voice-forward, type-default.** Voice is how you *direct* Roro; typing is the silent open-office peer. Both are equal front-doors into the same brain.
- **Stay on Electron** (Tauri's macOS WKWebView still breaks mic/screen/transparency in 2026). Procedural PixiJS cat (no image assets).

## 3. Repo state (concrete)

- **Location:** `/Users/jinchoi/Code/roro` · **Remote:** private `gorajing/roro` · **Branch:** `main`.
- **Verified:** `npx tsc --noEmit` → 0 errors; `npx vitest run` → 61/61 (framePolicy, gaze, activity + the full A.5 memory spine: identity, PGlite store, recall, extractor, factStore, cross-launch persistence, orchestrator capture-screen).
- **Stack:** Electron 42 + electron-forge + Vite; PixiJS v7 procedural cat; TypeScript; Vitest.
- **The bones (kept, working):** `src/executor/{codex,claude}.ts` (CLI adapters, codex live-verified @0.139.0 → ActionEvent union), `src/main/orchestrator.ts` (the turn loop), `src/brain/index.ts` (decide/embed/vision via an OpenAI-compatible client; now also the 1-fact extractor), `src/memory/index.ts` (memory adapter — **now local PGlite + pgvector, owner-scoped**, with `src/memory/schema.ts`; plus `src/main/{identity,memoryContext,factStore}.ts`), `src/renderer/character/*` (the cat: avatar, driver, activity, framePolicy, gaze, stateMachine, lipsync, captions), `src/shared/{events,brain,memory,ipc,avatar,gaze}.ts`, `src/renderer/voice/*` (Vapi facade — **to be replaced with local voice**).
- **Phase A is already shipped** (in the bones): body gesture grammar (tap/hold=pet, drag=move, hover=gaze), cursor gaze, Activity/Energy sleep-wake, the frame governor.
- **Gotchas:** the internal `COMPANION_` env prefix is unchanged (deliberate later rename); dated `docs/.../2026-06-2x-nero-*.md` filenames keep their `nero-` slugs (content is Roro; renaming files would break cross-links). A `.env` with model keys is needed to run live (going local/BYO reduces this).

## 4. Architecture — how it works

**One chokepoint, `turnRun`, drives every interaction:**

```
 you talk/type ─▶ turnRun({transcript, sessionId})            [src/main/orchestrator.ts]
   1. RECALL    owner-scoped profile facts + related past moments   [src/memory → PGlite/pgvector]
   2. DECIDE    brain → {narration, command, args}                  [src/brain → BYO key]
   3. EXECUTE   run the coding agent in your repo                   [src/executor → codex/claude CLI, BYO]
   4. NARRATE   cat speaks/animates off the FROZEN 11-kind ActionEvent stream
   5. REMEMBER  post-turn: extract ≤1 durable fact, store it (owner-scoped)
```

- **The 11-kind `ActionEvent` union (`src/shared/events.ts`) is FROZEN** — it's the spine everything animates/narrates off. Don't add kinds casually (one planned addition, `status`, then re-freeze).
- **Provider-seam law:** every substrate sits behind an interface with a **local adapter** (free tier) and optionally a **hosted adapter** (later). Memory, brain, voice, executor are all swappable.
- **Streaming rule:** `ipcMain.handle` is request/response only; all token/action streams go over `webContents.send` push channels (`CH.actionEvent`, `CH.runEnd`, `CH.brainReasoning`, …). The invoke promise resolves with just `{runId}`.
- **Key hinge for Phase B:** `turnRun` currently `await`s the whole run before returning. It must **resolve at *dispatch*** (return `{runId}` once the executor is handed off) so Stop / preempt / voice barge-in become wireable. (Today the code claims "returns early" but actually awaits — see `orchestrator.ts`.)

## 5. Substrate — the stack (local-first)

| Layer | Direction | Notes |
|---|---|---|
| **Memory** | **PGlite (embedded Postgres) + pgvector, on-device** | Flips the old "keep Insforge" ruling — a *fresh repo has no corpus to migrate*, so choose local now. `owner_id`-scoped (device-stable UUID in userData). Facts: **owner-scoped, source-linked (`payload.source`), supersede-not-overwrite (`superseded` col), null-when-unsure.** Stamp **`embed_model`/`embed_dim`** on every row (the one irreversible choice → makes a future re-embed auditable). |
| **Embeddings** | **Qwen3-Embedding-8B @ 1536** | Top multilingual, open-weight, **runs locally via GGUF** (so the free/local tier isn't cloud-chained). 1536-dim. The *sticky* choice — lock it before writing a corpus. |
| **Brain (decide)** | **BYO-keys** (the user's own model) | Turns transcript → `{narration ≤25 words, command, args}`, streamed, JSON. Keep the defensive JSON parse. (Hosted Haiku-4.5 was a *hosted-tier* idea; in the free+cosmetic model the default is BYO/local.) |
| **Voice** | **Local-first hybrid** | whisper.cpp (STT) + Silero VAD (turn/barge-in) + Kokoro (TTS), all on-device, $0. **Mouth-not-brain:** committed transcript routes through `turnRun` (NEVER a speech-to-speech model that bypasses recall→decide→remember). **Summon, never always-on** (idle ~0). Voice is a **cosmetic surface** (voice packs / your cloned voice), not a metered utility. |
| **Executor** | codex/claude **CLI, BYO-keys** | Normalized to the frozen ActionEvent union. The agent's frontier tokens are the user's cost, not ours. |

## 6. Interaction model

- **Governing law:** disambiguate by **surface + state**, never by milliseconds. Three surfaces: **body** (tap/hold=pet, drag=move, hover=gaze, right-click=mute), **command surface** (Ask input + Stop pill; later menu/⌘K), **keyboard mirror**.
- **Five laws:** instant body feedback <100ms; never punish; always reversible; **always pettable**; exactly **one deliberate action to start work**.
- **Voice = a deliberate Mode** (summon toggle + persistent listening tell + barge-in), never push-to-talk.
- Deep spec: `docs/superpowers/specs/2026-06-21-nero-ultimate-ux-design-PROPOSAL.md` (the "v2 spine" — still the canonical interaction design; ignore its voice-substrate + monetization sections, which §9 supersedes).

## 7. Monetization — free core + cosmetics (THE pivot)

**The entire functional product is FREE** (cat, drives-your-agent, local memory, local voice — all local, $0 to the team). A paid "$5/$25 sync/Pro" tier was evaluated and **rejected** ("why pay if it's all local?"). Instead:

- **Monetize the BOND via COSMETICS**, sold as **buy-once ASSETS that run locally** (never metered cloud minutes): **alternate pets, wearable items, skins, voice packs, and your own cloned voice.** Cosmetics are ~$0 marginal cost (content, not compute), sidestep the privacy/abuse problems of paid hosted compute, and directly monetize the embodiment investment.
- **The `-ro` character roster is the catalog spine:** **Roro** = flagship/default pet; **Miro, Sero, Taro** = the first collectible alternate pets, named after the founder's real pets (authentic origin story + solves the cosmetic cold-start — you don't launch the store empty). New characters just need a `-ro` name.
- **The bond (built by free memory) is the engagement engine; cosmetics/identity-expression are the revenue.** Memory's job is retention; cosmetics' job is monetization — cleanly separated, so the wedge is never paywalled.
- **Platform upside:** a **creator/UGC marketplace** (community-made pets/items/voice packs, rev-share) — the scalable version where two people build the economy, not the art.
- **Open question to validate (the one real risk):** will *developers* pay for pet cosmetics (proven for gamers/consumers, unproven for devs)? Mitigated by ~$0 marginal cost (any conversion is pure margin) + "dev identity spend" (themes, keyboards, stickers) being real. **Validate cheaply before building the whole store.**
- **Memory stays 100% free, forever.** (`MONETIZATION.md` in this repo is the *superseded* $25-sync analysis — kept as the record of why sync was rejected. A full cosmetic-monetization design pass is a future task.)

## 8. Build plan & sequencing

Order (each phase independently shippable + verifiable):

1. **A.5 — Memory spine (✅ DONE, branch `feat/a5-memory-spine`).** Device-stable `owner_id`; PGlite + pgvector schema (owner_id + superseded + embed_model/embed_dim + a `seq` ordering key); owner-scoped recall + `getProfile`/supersede; thin 1-fact-per-turn extractor (null-when-unsure, source-linked, supersede, snake_case-normalized keys). Re-authored from the Insforge REST plan to **direct SQL on in-process PGlite** (no stored RPCs). Proven by an **automated cross-launch persistence test** (fact taught in "launch A" → real `close()` → reopen the same `dataDir` → recalled in "launch B," fresh session, same owner) — this subsumes the plan's manual Task 8. Hardened via a 7-round Codex cross-model review (race serialization, insert-before-supersede, allSettled fact/episode independence, capture-screen self-match, renderer fact-write guard). The original plan (`docs/superpowers/plans/2026-06-21-nero-a5-memory-spine.md`) is preserved as the spec.
2. **B — The magic moment (✅ DONE, branch `feat/b-magic-moment`, PR #2).** `turnRun` resolves at dispatch; floating `#floating-ask` (collapsed "Ask Roro…" pill → input, outside `#overlay`, ⌘⇧Space + click summon via `CH.focusAsk`) + a stream-subscribed Stop pill; all three turn callers (floating Ask, dev `#prompt-form`, voice) migrated onto stream-driven lifecycle. Pure `askMachine`/`runLifecycle`/`summon` cores + a jsdom-tested DOM shell. 89/89 tests, 4-round Codex-clean. Spec: `docs/.../2026-06-22-roro-b-floating-ask-stop-design.md`; plan: `docs/.../2026-06-22-roro-b-floating-ask-stop.md`. **On-screen check still owed** (no browser harness in CI). **Next: C1.**
3. **C1 — Reliability.** `status` event kind; preempt/cancel (`cancelTurn` + abortable `decide`); destructive-confirm (a spoken word can't approve `rm -rf`); Stop watchdog. (This is the layer voice depends on.)
4. **D — Voice (local).** whisper.cpp + Silero + Kokoro behind a `VoiceBackend` facade; ear-perk; mouth-not-brain through `turnRun`. Voice = cosmetic surface.
5. **Cosmetics/customization system.** Pet variants + wearable/item layer + voice-pack equip + the store; later the creator marketplace.

## 9. Superseded / reconciled (so old docs don't mislead you)

| Doc | Status |
|---|---|
| `MONETIZATION.md` | **SUPERSEDED.** It's the hardened $25-Pro/sync model, which was rejected. Real model = free-core + cosmetics (§7). Kept as the record of *why* sync failed. |
| `docs/.../2026-06-21-nero-voice-decision.md` | **Partially superseded.** Voice-forward/type-default, mouth-not-brain, summon-not-ambient, reject-LiveKit/Realtime all still hold. But "Vapi-hosted-first" → now **local-first voice** (§5), and voice monetizes as **cosmetics** not minutes (§7). |
| `docs/.../2026-06-21-nero-substrate-decision.md` | **Mostly holds**, except: memory → **PGlite local-first** now (not "keep Insforge"), and the brain hosted-default discussion is moot in the BYO/free model. The embedding-provenance-stamp + "embedding is the sticky choice" points still hold. |
| `docs/.../2026-06-21-nero-a5-memory-spine.md` | **IMPLEMENTED on PGlite** (§8 #1). Kept as the spec/rationale; its Insforge Task 1/3/8 were re-authored for in-process PGlite. |
| `docs/.../2026-06-21-nero-ultimate-ux-design-PROPOSAL.md` (the "v2 spine") | **Canonical for the interaction model** (§6). Ignore its voice-substrate (Vapi) and monetization (sync) sections — §5/§7 here supersede them. |
| `docs/ARCHITECTURE.md` | Background research, superseded by the above; some directions (provider seams, pgvector, MCP-later) still valid. |

## 10. Key decisions & gotchas (the "already decided" list)

- **Memory-first wedge.** Memory is the moat and ships first (testable headless). Voice is first-class but *rides on* memory ("voice with a dumb brain is worse than typed with a smart one").
- **Mouth-not-brain.** Voice never decides; it routes transcripts through `turnRun`. The old hackathon code had a **two-brain bug** (Vapi ran its own LLM in parallel with the orchestrator) — gone in the local-voice rebuild.
- **RAG, not fine-tuning** if/when a "personal model" is built — a fine-tuned weight that memorized a fact is undeletable (GDPR Art. 17 gap). RAG over the user's vectors = "forget" is just deleting the vector.
- **Frontier tailwinds:** Cartesia (on-device real-time voice, SSMs, voice cloning) and Thinking Machines (accessible personalization) are building the substrates that make "talk to a pet that knows you" feel alive on-device — Roro is the end-user surface that owns the relationship. Voice-cloning fits the cosmetic model perfectly.
- **Never paywall the wedge; gates (when paid) are capabilities/cosmetics, never throttles on the local core.**

## 11. Immediate next steps for the next agent

1. **Skim the canonical docs** in priority order: this `HANDOFF.md` → the "v2 spine" UX proposal (interaction model) → the A.5 plan (now the *spec* for the shipped memory spine).
2. **A.5 is done** (§8 #1, branch `feat/a5-memory-spine`). If not yet merged, fast-forward `main` to it (`git switch main && git merge --ff-only feat/a5-memory-spine`) or open a PR.
3. **Build Phase C1 — reliability** (§8 #3, branch `feat/c1-reliability` off B). The `status` ActionEvent kind (one planned addition to the frozen union, then re-freeze); preempt/cancel a turn (`cancelTurn` + an abortable `decide`); destructive-confirm (a spoken/typed word can't approve `rm -rf`); a Stop watchdog. Mostly backend + TDD-able; it's the layer voice (D) depends on. (B done — §8 #2.)
4. **Verify each step:** `npx tsc --noEmit` + `npx vitest run`; commit in small TDD increments.
5. (Optional, later) full cosmetic-monetization design pass; rename `COMPANION_`→`RORO_` (incl. the new `COMPANION_DB_DIR`); rename dated doc files.

**Working agreement:** TDD (red→green), small diffs, re-read files before editing, run the verifications, never claim "done" without a green test that would have failed before the change. Commit/push only when asked.
