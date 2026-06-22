# Roro — Unified Design Spine (Final, Hardened)

*The cute companion you talk to, that drives your coding tools, and remembers across them — with every click optimized.*

Lead-architect synthesis of six pillar designs + the ground brief, hardened against four adversarial critiques (Feasibility, Internal Coherence, Every-Click, Scope/YAGNI). Where the critiques exposed a mechanism that doesn't survive contact with the real code, the mechanism is now specified concretely (control-flow, IPC channels, ripple set) or cut. The wedge thesis — *memory-first, single-tool cross-launch continuity proven in one sentence* — is unchanged and validated; the scaffolding around it has been trimmed to what two people can ship.

---

## Status — ADOPTED (founder review, 2026-06-21)

**This is the governing v2 spine.** Adopted by the founder on 2026-06-21; it **supersedes `docs/ARCHITECTURE.md`** for all near-term decisions. Build order is locked: **A.5 → B → C1 → C2 → D** (owner_id + migration + extractor → floating Ask/Stop + dispatch-return → status/preempt/confirm → `.roro/PROFILE.md` → voice). **Do not start with voice or MoodCore; do not build a memory panel yet.** (The filename keeps its `-PROPOSAL` suffix only to preserve existing links; the status is adopted.)

### Founder amendment — memory facts are durable product data (folds into Pillar IV / Phase A.5)

The thin 1-fact-per-turn extractor must treat facts as **durable product data, not vibes**. Beyond owner-scoped + forgettable + null-when-unsure (already in Pillar IV), A.5 adds two cheap requirements:

- **Source-linked.** Every `fact` row carries provenance in its `payload`: `{ key, value, source: { session_id, turn_ts } }` — so any surfaced fact traces to the turn that taught it (and later feeds the deferred "What Roro knows…" panel).
- **Superseded, never silently overwritten.** When a new fact's `key` matches an existing *active* fact for the owner and the value changed, **mark the prior row superseded and insert the new one** (append-only history) instead of UPDATE-in-place. `getProfile()` returns only non-superseded facts. This is the thin stand-in for the deferred typed confidence/supersede engine: it costs one extra column (`superseded boolean default false`) + a key lookup, and it makes user correction a first-class, auditable operation.

---

## 0. CONFLICT RESOLUTIONS (read this first)

Six pillars disagreed on five real things. The rulings stand; three are now tightened because a critique showed the original ruling, while correct in policy, did not match the code.

**CONFLICT 1 — Voice-first vs Memory-first.** **RULING: Memory-first, unchanged.** Voice is real, designed-for, and ships behind a swappable seam in Phase D — but it never shapes the core loop and is **not** the wedge. The Zuhn KB is unambiguous: durable moats are data loops + workflow entrenchment, and a silent always-applicable memory retains ~70%+ through corrections; emotionally-loud-but-commodity voice UX does not. *Hardening:* Phase D ships **exactly one** voice backend (the server-hosted Vapi `vapiAssistantId` branch that works today), behind a one-method facade — not three backends. The swap seam is free; three integrations are not (Feasibility/Scope/Coherence all flagged this).

**CONFLICT 2 — Add a `status` ActionEvent kind, or never touch the union.** **RULING: Add `status`, gated to Phase C, then RE-FREEZE — unchanged in spirit, corrected in scope.** *Hardening (Coherence + Feasibility):* the change is **not** "one additive member mapped to null." It is an enumerated 5-site change set (§3) and — critically — the destructive-confirm round-trip is **NOT** an ActionEvent and does not live in the union at all. The union carries *observation* of what the agent did; *control* (confirm/deny) rides a separate request/response IPC pair. Re-freezing the union after `status` is consistent only because confirm was never going to be a kind.

**CONFLICT 3 — Is asleep / in-call / listening a 7th AvatarState?** **RULING: No — orthogonal hooks, never states. Ratified.** *Hardening (Coherence):* there is a **name collision** the draft missed. `listening` is already a canonical AvatarState produced *only* by the voice call lifecycle (`call-start→listening`). The mic-RMS ear-perk is a **different** thing and is renamed **`setEarPerk(boolean)`** so `listening` has exactly one meaning. The typed path (Phases A.5–C) never enters `listening`; it goes `idle→thinking→working→done`.

**CONFLICT 4 — Floating command surface: Menu or not?** **RULING (revised by Scope):** Phase B ships ONLY the floating Ask input + Stop pill. The native Menu/Tray/⌘K surface is **cut from the committed plan**, not merely "sequenced to C." Right-click keeps toggling mute (the working Phase-A placeholder) indefinitely. A Menu lands only *if and when users ask where Quit/Sleep live* — it has zero wedge leverage. Both the Ask input and the (eventual) Menu live OUTSIDE `#overlay` (the non-negotiable structural constraint).

**CONFLICT 5 — Thin distill vs typed `profile_fact` engine.** **RULING: Thin first (Phase A.5), typed engine deferred — unchanged.** *Hardening (Scope/Feasibility):* the thin extractor is specified concretely (§Pillar IV, a second cheap post-turn Nebius call returning ≤1 fact or `null`), not hand-waved as "~40 lines." The **one non-negotiable in A.5 is minting the device-stable `owner_id`** — and A.5 now correctly includes the **hosted-Insforge SQL migration** (DDL + `match_memory` RPC signature change) that the draft omitted entirely.

---

## 1. NORTH STAR

**The product truth:** Roro is a cute desktop companion that is the embodiment of a coding-agent runner with a memory. You talk or type to it, it drives Codex/Claude to do real work in your repo, it shows you exactly what ran (network-tab honesty made cute), and — the moat — it remembers you across launches. Cuteness is the wrapper on competence; memory is why you reinstall. It costs nothing while idle and never nags.

**THE single magic moment (the demo) — now told honestly.** In a session days ago you asked Roro to add a feature and accepted its offer to write a test alongside it; that taught it one fact, persisted to disk. Today — app fully quit and relaunched since, fresh `session_id`, **same `owner_id`** — you type *"add a logout route"* into the slim Ask line under the floating cat. Before the narration finishes, the cat says, unprompted: **"On it — and like last time I'll add a test alongside it."** You never made an account. The continuity survived a full process restart. The cat drops into thinking, walks (working) as Codex edits your repo, throws a green check, self-decays to idle.

**The honest mechanism (Coherence fix):** the line is **recall of a fact taught in a *prior* turn**, not extraction on the demoed turn. The fact was written post-turn last session, persisted to the store under `owner_id`, and on *this* turn is read by `getProfile()` into a **labeled segment** of `DecideInput.memory` (kept separate from truncated episodic summaries) so the brain narrates with the relationship in context. On a **first-ever turn with no facts, the cat says no continuity line** — it just acknowledges and acts (cold-start narration is specified, §4). Everything in this document exists to earn that one recalled line and make every click around it instant.

---

## 2. THE FOUR PILLARS

### Pillar I — COMPANION (the soul) — *radically trimmed*

**What GREAT means:** a developer leaves Roro running for weeks because closing it feels like dismissing a colleague mid-thought; the cat visibly listens, leans into hard problems, winces at a red test and *recovers*, celebrates a green run, dozes when you walk away without nagging.

**Key decisions (Scope/Coherence rulings applied — MoodCore and Bond are CUT from the committed plan):**
1. **No persistent inner-state primitive in the wedge.** The draft's `MoodCore {valence,energy}` scalar, `bond.json`, the monotonic Bond integer, and the wake-stretch greeting tier system are **cut from Phases A.5–C entirely.** Three critiques independently flagged them as soul-polish with zero leverage on "remembers across launches," and as Tamagotchi-adjacent risk the doc itself disavows. They earn nothing toward the magic line.
2. **What survives is transient, zero-persistence, already-on-the-wire:** the existing terminal cues. `run.completed→done` (green check + a brief happy hop, ~2.5s, then idle); `run.failed→error` (ears un-flatten, comfort posture, never a sustained sulk, self-decays). These are *reactions to events the user just witnessed*, not stored mood. No new files, no new persistence, no per-frame mood modulation.
3. **The "Remembering" micro-beat (the moat made visible) survives** — but is re-sourced (Coherence fix). It rides the **new `status` event's typed field** (`status.kind:'recall'`), *not* `text.startsWith('Insforge memory')`. `activityForEvent`'s `case 'message'` Insforge branch is **deleted** and replaced with a `case 'status'` branch keyed on `e.status.kind === 'recall'`. The mote drifts into the cat's head and is absorbed.

**On the real architecture:** the only new soul code in the wedge is the `status→recall` cue re-source (a Phase-C edit, listed in the status ripple set). MoodCore/Bond return only as an explicit post-PMF item (§7), not a phase.

### Pillar II — TALK (the voice you summon, never always-on) — *one backend*

**What GREAT means:** you glance at the cat, say *"Roro, fix the failing test,"* its ears snap up the instant the first sound leaves your mouth (sub-100ms, before any network), it thinks, then answers in its own voice with words the *real brain* chose. In an open office you do the identical thing silently by typing.

**Key decisions:**
1. **The speech model is a MOUTH and EARS, never a BRAIN.** STT/VAD/barge-in/TTS live at the edge; the committed transcript *always* routes through the single chokepoint `companion.turnRun({transcript, sessionId})` so recall→decide→remember→executor stays authoritative. **The Vapi-inline-LLM-speaks path is deleted** (the "two unequal brains" bug). One integration test is the guard: a spoken "fix the test" must produce a `CH.turnRun` *and* an executor `run.started`.
2. **One backend, behind a one-method facade (Scope/Feasibility/Coherence ruling).** Ship `VapiBackend` only — the server-hosted `vapiAssistantId` branch, the only path that works today, which also **deletes the missing ngrok/proxy/PATCH glue and the 8787/8788 port mismatch** (you don't need the inline proxy when the assistant is server-hosted). The `VoiceBackend` interface (`connect/onUserTranscriptFinal/onVolume/say/setMicMuted`) is defined so a second backend can slot in later — but **OpenAI-Realtime and Pipecat-local are NOT built.** *Critical correction (Coherence):* OpenAI Realtime is natively speech-to-speech, the exact substrate Risk 2 warns against; recommending it as default contradicted the "mouth not brain" ruling. It is dropped from the recommendation.
3. **`setEarPerk(boolean)` (renamed, Conflict 3), instant local mic-RMS feedback, one-voice narration.** The cat speaks `Decision.narration` (the real ≤25-word brain output) via `backend.say()` — **not** the hardcoded `"Done. I finished that."` at `bootstrap.ts:196`. A 45s idle-silence timeout in `VoiceController` (soft "still there?" at T-10s, "I'll be here" sign-off) ends a forgotten call so it can never bill indefinitely.

**On the real architecture:** `voice/micMeter.ts` taps the already-TCC-permissioned `getUserMedia` stream through an `AnalyserNode`, fires `driver.poke()` + `driver.setEarPerk(true)` on the rising edge *before any STT result* (fixes "summon pokes nothing"). **Voice is Phase D.** The seam is designed now; nothing in A.5–C depends on it.

### Pillar III — DRIVES TOOLS (transparent, interruptible, never lies) — *control-flow now specified*

**What GREAT means:** a developer watches their coding agent work *through* the cat — every read, command, and edit narrated live off the real event stream — and trusts it like a debugger, because **Stop always hard-stops, a mishear never fires `rm -rf`, and what the cat shows is byte-for-byte what the agent did.**

**Key decisions:**

1. **PREEMPT (barge-in) requires the turnRun contract to change — and it does (Feasibility/Coherence CRITICAL fix).** The draft's "renderer-side cancel-then-start loop" is **unwireable**: `turnRun` blocks until the entire run finishes (`orchestrator.ts:290` awaits `actOnDecision`→`dispatchExecutor`; `bootstrap.ts:226`), and the submit handler early-returns on `turnInFlight` — the renderer is blocked inside its own `await` with no concurrency to receive a second input.
   **RULING:** Split the chokepoint. **`turnRun` now resolves at *dispatch time*, returning `{runId}` as soon as the executor registers** (or immediately for `answer`/`clarify`), **not at terminal.** All turn lifecycle is driven off the existing `CH.actionEvent` / `CH.runEnd` push stream the renderer already subscribes to. This makes PREEMPT trivially wireable: a mid-run submit reads the current `runId` from `runState`, calls `cancelTask(runId)`, and on its `runEnd` push fires the new `turnRun`. This is the **one** change to the chokepoint's return semantics; it is explicitly stated and propagates to: `orchestrator.runTurn` return point, `bootstrap.ts` `turnInFlight` model (now driven by `runState` from the stream, not by the `await`), and the §3 dataflow. **Preempting a turn still in DECIDE** (no executor registered, `activeRuns` empty): add an orchestrator-side `cancelTurn(runId)` that sets an abort flag checked at the `decideStreaming` boundary and before `dispatchExecutor`, so a barge-in during recall/decide is honored without an executor handle.
   Add a **1.5s SIGKILL watchdog** after abort so "Stop" is provably terminal.

2. **Confirm-before-destructive is a MAIN-side gate over a NEW request/response IPC pair (Feasibility/Coherence CRITICAL fix).** The draft's "`CH.confirmRequest → PAUSE`" cannot work on a push-only/invoke-only model. **RULING — specify the actual handshake:**
   - MAIN pushes `CH.confirmRequest {runId, summary}` to the renderer (push channel).
   - The renderer renders a **confirm chip** (a body hook posture, not a 7th state — see §4) and, on the user's click, calls a **new invoke channel `CH.confirmResolve {runId, approved}`**.
   - In the orchestrator, `actOnDecision`'s `run_agent` branch — **before `dispatchExecutor`** — calls `classifyDestructive(task)`; on a hit it `await`s a Promise held in a new `pendingConfirms: Map<runId, (approved:boolean)=>void>`, resolved by the `CH.confirmResolve` handler, with a **15s timeout that default-denies.** This is new IPC plumbing in Phase C, acknowledged as such, riding *alongside* the destructive classifier — not a free rider.
   - The spoken transcript can **never** approve (a stray "yeah" in the room does nothing); approval is the dedicated `CH.confirmResolve` channel only.
   - `classifyDestructive(task)` is a small high-confidence set: `rm -rf`, `git push --force`, `reset --hard`, `drop/truncate`, `dd`, `mkfs`, history-rewrite, anything outside `workdir()`. **Plus require a clean git tree before a confirmed-destructive run.**
   - **Tier-1 only (both agents): classify before dispatch.** This is the only seam Codex exposes (`codex exec` has already written by the time the event arrives). **Tier-2 (Claude `--permission-prompt-tool` mid-run per-tool approval) is CUT** from the committed plan (all three of Feasibility/Coherence/Scope flagged it as speculative; Tier-1 pre-flight + clean-tree covers the mishear case). The `getExecutor` capability table that routed risky tasks to Claude is also cut.

3. **The `status` kind** migrates the synthetic "Insforge…/DeepSeek…" beats off `message`, keeping `message` pure for real speech and unblocking one-voice narration.

**On the real architecture:** everything hangs off existing seams. The `Executor` interface gains **`resumeId?` only if and when resume ships** (it is deferred — see Cuts); the `approve?` field is cut with Tier-2. `dispatchExecutor`/`actOnDecision` gain the PREEMPT abort-flag + destructive gate. The fixtures harness (`__fixtures__/check.ts`) gains an **aborted-mid-stream test** (exactly one terminal event) and a **destructive-flag test** (a `rm -rf` task is flagged pre-dispatch).

### Pillar IV — REMEMBERS ACROSS THEM (the moat) — *extractor specified, MCP cut*

**What GREAT means:** weeks in, after a full restart, the cat says something only a thing watching you for weeks could say — *"last time you reached for Redux you hated it, want Zustand like before?"* — and it's **right**, because it speaks from a fact you taught it in a prior session.

**Key decisions:**

1. **Mint a device-stable `owner_id` NOW — and run the SQL migration that goes with it (Feasibility MAJOR fix).** A v4 UUID persisted to `app.getPath('userData')/owner.json`. The draft sold this as "~20 lines of TS"; the real work is a **hosted-Insforge migration** with a deploy step, now in scope for A.5:
   - `alter table memory add column owner_id text;`
   - **drop + recreate `match_memory`** with a new `p_owner_id text` param and a `where owner_id = p_owner_id` clause (a Postgres function signature change *requires* drop+recreate — a coordinated DDL deploy, not edit-and-rebuild). **Keep `p_session_id` in the signature** so the old path keeps working during transition.
   - `remember()` insert body + `RememberInput` + the recall RPC call all gain `owner_id`.
   - **`owner.json` corruption/partial-write/manual-delete handling (Every-Click fix):** write atomically (temp file + rename); on a missing/garbled file at boot, **do not silently re-mint** — log loudly and re-mint only as last resort, because a silent re-mint orphans all prior memory (the exact failure `owner_id` exists to prevent).

2. **The thin 1-fact-per-turn extractor is specified, not hand-waved (Scope/Feasibility CRITICAL fix).** After a turn completes, **off the critical path**, a second cheap Nebius call takes `{transcript, decision, terminal outcome}` and returns **at most one `{key, value}` or `null`** (returns `null` when unsure — write no row). It writes the existing-but-unwritten `MemoryKind:'fact'` row under `owner_id`. The fact written in session N is recallable in session N+1 across a restart because it persists to the store. **The proof is a fixture (extends the A.5 cross-launch fixture):** "add a feature with a test" in simulated launch A produces a `fact` row that, in simulated launch B (fresh `session_id`, same `owner_id`), is read by `getProfile()` and its text appears in the recalled context. Until that fixture is green, the magic moment is unproven.

3. **Cross-agent exposure: markdown mirror ONLY for the wedge; MCP server CUT from the committed plan (Scope CRITICAL fix).** The distiller writes a size-capped `<repo>/.roro/PROFILE.md` (<150 lines, plaintext = the privacy proof; zero-integration = any file-reading agent gets the profile free — Claude Code and Codex read it with no config). This delivers ~90% of "across them" at ~zero protocol surface. **The 4-tool stdio MCP server, the `MemoryDistiller`-as-sole-promoter ceremony, the `source_agent` append-only protocol, and the typed confidence engine are all deferred to genuinely-later** — they are an irreversible coupling contract external agents lock onto, and must not be built before the single-tool continuity moment is demonstrably retaining users. Positioning discipline holds: headline is "the coding pet that remembers you"; cross-agent is *sentence two*; "Memory API" framing is **banned.**

**On the real architecture:** `recallContext` composes a **labeled two-part string** — `getProfile()` facts (a distinct, labeled segment) + episodic `recall()` matches — into the *existing* `DecideInput.memory` field. **No change to the Decision contract or the frozen union.** `buildDecisionPrompt` is updated to consume the labeled fact segment (so facts aren't lost in truncated episodic noise — the lossiness the ground brief flagged). Every surfaced fact is forgettable via a "What Roro knows…" panel (console-hosted first, deferred to post-wedge). **Credibility guard:** in the thin version, a fact surfaces if it exists (the extractor's `null`-when-unsure is the gate); the typed `confidence ≥ 0.6 ∧ support ≥ 2` gate arrives only with the deferred typed engine. *A silent cat beats a confidently-wrong one.*

---

## 3. UNIFIED ARCHITECTURE

### The seams (the spine the team builds against)

| Seam | File | Role after redesign |
|---|---|---|
| Turn chokepoint | `orchestrator.runTurn(TurnInput)` | **Resolves at DISPATCH, returns `{runId}`** (not at terminal). Lifecycle driven off the push stream. + `cancelTurn(runId)` for pre-executor preempt |
| Executor interface | `shared/events.ts` `Executor.run(opts)` | Universal tool driver. **Unchanged for the wedge** (`resumeId?`/`approve?` deferred with resume/Tier-2) |
| **ActionEvent union** | `shared/events.ts` | **11 kinds after `status` is added — then RE-FROZEN.** Confirm is NOT a kind |
| Decision contract | `shared/brain.ts` | 4-command router. `DecideInput.memory` carries a **labeled** profile+episodes string (shape unchanged) |
| Avatar mapper | `shared/avatar.ts` `eventToAvatarState` | 6 states. `status→null` (default case already covers it — **no edit needed**). Frozen |
| Character facade | `character/types.ts` `CharacterDriver` | + `setEarPerk` (renamed from setListening), + confirm-chip posture hook. **No `setMood`** (cut) |
| Memory store | `memory/index.ts` + SQL migration | **`owner_id`-scoped.** flat log + thin `kind:'fact'` rows. `match_memory` RPC re-created with `p_owner_id` |
| Identity | `main/identity.ts` (new) | device-stable `owner_id`, atomic write, loud-fail on corruption |
| Voice facade | `voice/index.ts` `VoiceController` | `VoiceBackend` interface defined; **only `VapiBackend` built** |
| Confirm IPC | `CH.confirmRequest` (push) + `CH.confirmResolve` (invoke) + `pendingConfirms` Map | The destructive handshake. NOT in the union |
| Floating UI host | `#floating-ask` (new, OUTSIDE `#overlay`, own pointer-events box) | The un-inverting fix |
| Energy governor | `framePolicy.ts` + `activity.ts` | Near-zero-idle law. **No `setEnergyOverride`** (cut with DND) |

### The status-kind ripple set (Phase C — enumerated, Feasibility/Coherence fix)

Adding `status` is **5 sites + 1 fixture**, not a one-liner:
1. `shared/events.ts`: add `status {runId, kind:'recall'|'planning', text, n?, ts}` member → re-freeze.
2. `shared/avatar.ts` `eventToAvatarState`: **no change** — default case already returns `null`. (Confirmed by reading the mapper.)
3. `actionEvents.ts`: **delete** the `case 'message'` / `text.startsWith('Insforge memory')` branch; **add** `case 'status'` keyed on `e.status.kind` (drives the "Remembering" mote off `status.kind==='recall'`).
4. `orchestrator.ts`: migrate the **two synthetic beats** (`recallContext` recall beat, the planning beat) from `kind:'message'` to `kind:'status'`. **`emitNarration` STAYS on `message`** (it's real speech).
5. `orchestrator.ts` `memoryKind()`: add `status` to the **skip list** (like `message.delta`) so sponsor/status beats never pollute memory.
6. `__fixtures__/check.ts`: assert the canonical sequence still holds and `status` events are skipped by memory.

### The turn loop, WITH preempt, confirm, and memory

```
 VOICE (Phase D)                          TYPED (Phase B — ships first)
   mic → VapiBackend (STT/VAD edge)         #floating-ask (OUTSIDE #overlay,
   micMeter.ts: RMS rising edge               own pointer-events box, z above canvas)
     → poke()+setEarPerk(true) [<80ms]        │ Enter
   final user transcript ───────┐             │
                                ▼             ▼
                    companion.turnRun({transcript, sessionId})   ← THE ONE CHOKEPOINT
                                │  RESOLVES AT DISPATCH → {runId}   (NOT at terminal)
                                ▼
        ┌──────────────  orchestrator.runTurn()  ──────────────┐
        │ if cancelTurn flag set → abort early (pre-executor)  │
        │ 1. recallContext(owner_id):                          │
        │      getProfile() facts [LABELED segment, local]     │
        │      + recall() episodes [pgvector, owner_id]         │
        │      → composed LABELED string into DecideInput.memory│
        │      → push kind:'status'{kind:'recall', n}          │ (was kind:'message')
        │ 2. rememberUserSaid(owner_id, observation)           │
        │ 3. decideStreaming() → brain.decide()                │
        │      reasoning → CH.brainReasoning → 'thinking'       │
        │      (abort flag checked at this boundary)            │
        │      → Decision{narration, command, args}            │
        │ 4. actOnDecision:                                    │
        │      answer/clarify → emitNarration(message) + runEnd│
        │      run_agent → classifyDestructive(task)?          │
        │         hit → push CH.confirmRequest{runId,summary}  │
        │                await pendingConfirms[runId]          │
        │                (15s timeout → deny;  deny → runEnd)  │
        │                renderer → CH.confirmResolve{approved}│
        │         clear/approved → dispatchExecutor(...)       │
        │            ← runTurn RESOLVES HERE with {runId}      │
        │            getExecutor(agent).run({repo,prompt,signal})│
        │            for await ev: pushEvent → CH.actionEvent  │
        │              notifyJobDone (terminal)                │
        │              rememberEvent(owner_id) [fire-forget]   │
        │ 5. AFTER terminal (off critical path):               │
        │      thinFactExtract(owner_id) — 1 cheap Nebius call │
        │        → ≤1 kind:'fact' row or null                  │
        │        → rewrite .roro/PROFILE.md                    │
        └──────────────────────────────────────────────────────┘
                                │
   CH.actionEvent / runEnd / confirmRequest → renderer/events/actionEvents.ts
        → eventToAvatarState → setState (6 states)
        → status{kind:'recall'} → "Remembering" mote
        → confirmRequest → confirm-chip posture hook (NOT a 7th state)
        → run.completed → voice.speak(REAL narration) [Phase D]
   PREEMPT: mid-run submit → read runId from runState → cancelTask(runId)
            → on runEnd push → turnRun(new). Pre-executor → cancelTurn(runId).
```

### Memory model + cross-agent (wedge scope)

```
 IDENTITY: main/identity.ts → owner.json (uuid, atomic write, loud-fail)  ← Phase A.5

 SUBSTRATE: Insforge/pgvector (build owner_id + kind:'fact' HERE; no PGlite swap in M1)

 ONE TABLE for the wedge: memory (flat log + thin fact rows)
   - kind: observation/action/narration  +  fact (thin, 1/turn, null-when-unsure)
   - recall() = pgvector cosine, owner_id-scoped, session_id kept as provenance
   - getProfile() = local indexed lookup of kind:'fact' rows → LABELED segment

 CROSS-AGENT (wedge): .roro/PROFILE.md mirror ONLY (<150 lines, plaintext)
   → Claude Code / Codex read it for free, zero MCP config

 DEFERRED (post-PMF, not a phase): typed profile_fact engine (confidence/support/
   supersede/decay) + async MemoryDistiller + 4-tool MCP server. Built only once
   the single-tool continuity moment is empirically retaining users.
```

### Near-zero-idle lifecycle (a product law)

```
 every ticker frame: energy = Activity.energy(now)
   → framePolicy(visible, energy, busy, inCall):
       !visible → STOP (0fps) ; busy||inCall → 60fps ; asleep → 6 ; drowsy → 12 ; else 60
 Activity: 45s → drowsy ; 120s → asleep. ONLY poke() wakes (pet, summon, task-submit).
 During a long run: busy=true holds 60fps AND the avatar pose stays in 'working' —
   pose follows AvatarState, NOT the energy branch (Every-Click fix: a curled-asleep
   cat rendering at 60fps mid-build is incoherent; busy suppresses the sleep-curl pose).
 RULE: nothing we add bills at idle (no always-on vision/mic, no SFU, no interval
   distillers — extract is event-gated, post-turn; forgotten voice calls die at 45s).
```

---

## 4. EVERY CLICK OPTIMIZED

### The Five Laws (testable, enforced at code points)

1. **Disambiguate by SURFACE + BUTTON + STATE, never by milliseconds.** Every intent sorts onto `{continuous-reversible → body, named-verb → Ask/Stop pill, mode → explicit toggle with visible tell}`.
2. **Accidental-trigger probability ∝ inverse of cost/irreversibility.** Tap (free, reversible) easiest; Stop (loses partial work, confirm if destructive) and destructive-approve (dedicated channel) hardest.
3. **Latency is a CEILING; predictable beats fast.** L1: body reaction fires **synchronously in the handler before any `await companion.*`** — this is an explicit **renderer-local optimistic pose** (Feasibility fix: the first loop-driven avatar change is gated on cloud recall, so the instant `thinking` pose is local, set before the await, reconciled when the stream arrives). Budgets: tap→hearts ≤16ms; Enter→thinking ≤16ms (local); summon→visible ≤150ms; ear-perk ≤80ms (local RMS, pre-network).
4. **One creature, not a mode panel.** The body has **exactly four bindings forever**: tap=pet, hold=pet, drag=move, right-click=mute (until/unless a Menu ever lands). Only the *reaction* changes per state.
5. **No dead-ends; tells over modes.** Every state has an advancing input; every consequential input is reversible mid-flight (Stop reachable via the floating pill); terminal states self-decay to idle in **one place at one value (~3s) — the two timers are unified into the driver/state-machine** (Coherence/Feasibility fix; the `avatar.ts` terminal-fade duplicate is deleted). Anything the cat is *doing* invisibly (mute, in-call, awaiting-confirm) is a glanceable badge.

### SURFACE × STATE × GESTURE (every pair covered — including the new ones)

**BODY (`installFloatingWindowGesture`):** the canvas gesture handler **ignores pointerdowns whose `event.target` is the Ask box or confirm chip** (Every-Click CRITICAL fix — not just a `button` check), so a click on Ask never reads as a pet/drag on the canvas beneath.

| State | Left tap/hold | Drag >6px | Hover | Right-click |
|---|---|---|---|---|
| idle | pet (hearts ≤16ms) + poke | grab + moveWindowBy | gaze + Ask fades in | mute (toggle) |
| listening (voice-only) | pet, never hang up | move | gaze + Ask | mute |
| thinking | pet, never cancel | move | gaze + Ask | mute |
| working | pet, never cancel | move (run continues) | gaze + Ask | mute |
| **awaiting-confirm** | pet (Law 4) | move | gaze + Ask | mute |
| in-call (voice-only) | pet, never hang up | move | gaze + Ask | mute |
| done | pet | move | gaze + Ask | mute |
| error | pet (comfort) | move | gaze + Ask | mute |
| asleep | wake+stretch | move | gaze frozen | mute |

*Sustained-pet invariant (Every-Click fix):* the 450ms pet-interval `poke()` during working/in-call/awaiting-confirm is intended (holds full-rate, harmless); a drag stops the pet but never touches run/call/confirm lifecycle.

**ASK INPUT (`#floating-ask`, OUTSIDE `#overlay`, own pointer-events box, z above canvas):** `pointer-events:none` until revealed (background clicks pass through a transparent window — Every-Click CRITICAL fix reconciling the click-through expectation); Enter→`turnRun` (sets local `thinking` *before* the await; **empty-check runs BEFORE the pose set** so an empty Enter never flashes thinking — Coherence fix); collapses to a "tasked: …" pill; Esc dismisses Ask.
- **Ask × thinking (Feasibility fix — this pair was undefined):** a submit during DECIDE (no executor yet) calls **`cancelTurn(runId)`** (the pre-executor abort flag), then fires the new turn. It does NOT pretend to "Stop" an executor that isn't registered.
- **Ask × working:** submit → inline **"Stop current & start this?"** confirm chip → on yes, `cancelTask(runId)`, await `runEnd`, fire new turn (PREEMPT). The `turnInFlight` early-return is **replaced** by this branch (Feasibility/Coherence fix — the guard is inverted, not honored).

**STOP PILL (floating, Phase B):** a NEW element outside `#overlay` that **subscribes to the `run.started`/`runEnd` push stream directly** (Every-Click fix — independent of the hidden `#cancel-btn` handler); armed on `run.started`, calls `cancelTask(runId)`.

**CONFIRM CHIP (floating, Phase C — the safety-critical surface, fully specified):** a body posture hook (NOT a 7th state, Conflict 3) shown on `CH.confirmRequest` with explicit **Yes/No** buttons.
- Tap/pet the cat while pending: allowed (Law 4). Drag: moves window, chip persists.
- **Esc while pending = DENY** (resolves `CH.confirmResolve{approved:false}`), never a silent dismiss that strands the run.
- **Occlusion while pending (⌘⇧Space hide):** auto-deny on hide (the run never starts silently), surfaced via the native Notification path that already fires on terminals.
- **Sleep/idle-timeout while pending:** `poke()` is suppressed during awaiting-confirm so the user thinking it over doesn't trigger drowsy; the 15s confirm timeout (default-deny) bounds it regardless.

**KEYBOARD (thin mirror):** `⌘⇧Space` summon → if **hidden**: `showInactive` + `CH.focusAsk` (focus Ask + `driver.poke()`); if **already visible**: it HIDES, and **does not poke/focus** (Every-Click fix — don't wake a cat you're dismissing). `⌘⇧M` mute. **Esc:** dismiss Ask if open; else deny a pending confirm; else (Phase B, no Menu) **no-op** — the body's "never cancel via tap" and the keyboard are reconciled by the Stop pill being the single cancel affordance (Feasibility fix on the overloaded-Esc conflict). Bare-`m` is removed.

### One full session — numbered walk-through

1. **WAKE (relaunch).** `showInactive()` (never steals focus). `identity.ts` reads the *same* `owner_id` (loud-fail if corrupt, never silent re-mint). No bond/greeting tier (cut). *Body: settles to idle.*
2. **SUMMON.** `⌘⇧Space` (hidden→show) → cat forward + caret in "Ask Roro…" + `driver.poke()`. *Body: ears perk. [≤150ms]*
3. **TYPE (or TALK, Phase D).** Enter / final transcript → `turnRun`. *Body: empty-check, then local `thinking` pose [≤16ms, before await]; voice: ear-perk [≤80ms].*
4. **DRIVE — recall.** `recallContext(owner_id)` pulls **labeled** profile facts + episodes into `DecideInput.memory`; `status{kind:'recall', n}` beat. *Body: memory-mote drifts into the head (moat made visible, off the typed field — not a string sniff).*
5. **DRIVE — decide.** `brain.decide` streams reasoning. *Body: sits, eyes up-left, thought-mote.* `turnRun` has **already resolved with `{runId}`** — the renderer is free to receive a barge-in.
6. **NARRATE / CONFIRM.** `Decision.narration` (the recalled magic line, or a plain cold-start ack on a first-ever turn) → caption + (Phase D) `voice.speak(REAL text)`. If destructive → **confirm chip** with Yes/No; a stray spoken "yeah" does nothing. *Body: talking hook, or confirm-chip posture.*
7. **DRIVE — execute.** `command`/`file_change`/`tool` → `working`. *Body: walks, work-aura, above-head label "editing logout.py"; pose stays 'working' even past 120s (busy suppresses sleep-curl).* PREEMPT available.
8. **REMEMBER (off critical path).** Terminal `run.completed` → native Notification, `thinFactExtract(owner_id)` fires post-turn, writes ≤1 `fact` row + rewrites `.roro/PROFILE.md`. *Body: green check + brief happy hop (transient, no persisted mood).*
9. **SETTLE.** Terminal → unified ~3s decay → idle (one timer, one place).
10. **SLEEP (guilt-free).** 45s → drowsy (12fps); 120s → asleep (curl, 6fps, gaze frozen). No notification, never sad. Voice call (if any) auto-ends at 45s silence. *Costs nothing.*

### Phase-coherence note (Every-Click fix — each phase is independently click-complete)

- **Phase B surface = floating Ask input + Stop pill + right-click=mute + cursor-gaze.** No Menu, no confirm chip (no destructive gate yet), no voice. This is a complete, coherent surface: you can task, stop, mute, and it watches you. A trackpad two-finger tap (= contextmenu) mutes; that's the *only* command verb besides Ask/Stop, and it's discoverable enough for the wedge.
- **Phase C adds:** `status` kind + the confirm chip + PREEMPT. Right-click still = mute (Menu cut). Surface stays coherent.

---

## 5. BUILD SEQUENCE

Phase A is **already shipped** (deleted hold-to-talk, gaze decoupled from poke, single drag path, 45s/120s sleep, `inCall` in framePolicy, mute badge, terminal self-decay). Each phase below is independently shippable and verifiable. **For a 2-person team the realistic shippable surface is A.5 → B → C1 → C2;** voice (D) and the typed/MCP moat engine are honest fast-follows, not guaranteed.

| Phase | Goal | Seam(s) touched | Demo unlocked | Test that proves it |
|---|---|---|---|---|
| **A.5 — The un-retrofittable spine + DB migration + ship-ability** | Mint `owner_id` (atomic, loud-fail); **SQL migration: `memory.owner_id` + drop/recreate `match_memory` with `p_owner_id`, keep `p_session_id`**; rescope recall session→owner; thin `kind:'fact'` extractor (post-turn Nebius, null-when-unsure); resolve `codex` binary via PATH + `COMPANION_WORKDIR` first-run prompt | `main/identity.ts` (new), SQL DDL+RPC (deploy step), `shared/memory.ts`, `memory/index.ts`, `executor/codex.ts` | **Cross-LAUNCH on the SAME device** (quit fully, relaunch, fresh `session_id`, same `owner_id`, prior fact recalled). NOT cross-machine (per-device id isolates devices — Feasibility fix) | Fixture: a `fact` row written under `owner_id` in simulated launch A, with a *fresh `session_id`*, is recalled in simulated launch B and its **text appears** in the composed context. Clean-machine launch verified by running, not code-read |
| **B — The un-inverting fix (the magic moment)** | Floating `#floating-ask` (OUTSIDE `#overlay`, own pointer-events box, target-aware gesture handler) + Stop pill (subscribes to stream directly); **`turnRun` resolves at dispatch**; labeled fact segment into `decide()` | `#floating-ask` + CSS (new rule, NOT un-hiding overlay), `orchestrator.runTurn` return contract, `bootstrap` turnInFlight→runState, `recallContext` compose, `buildDecisionPrompt` | **THE magic moment:** type "add logout route" on the floating cat → "like last time I'll add a test" → drives Codex | E2E: typed turn on floating body produces `run.started`; second-launch turn surfaces a prior-session fact in narration; empty Enter never flashes thinking |
| **C1 — Reliability (the bond)** | `status` kind (the enumerated 5-site ripple + re-freeze); PREEMPT (cancel-then-start via stream + `cancelTurn` for pre-executor); Tier-1 destructive pre-flight + confirm IPC (`CH.confirmRequest`/`CH.confirmResolve`/`pendingConfirms`, 15s default-deny) + clean-tree precond + 1.5s SIGKILL watchdog; unify terminal decay into one place | `shared/events.ts` (the ONE union change), `actionEvents.ts` (delete sniff, add `status` case), `orchestrator` (migrate beats, preempt, gate, confirm Map) | "Stop always stops"; "say *clean up* → cat asks before `reset --hard` (spoken 'yeah' ignored)" | Fixtures: aborted-mid-stream = exactly one terminal event; `rm -rf` task flagged pre-dispatch; confirm timeout default-denies |
| **C2 — Markdown mirror (cross-agent, zero protocol)** | Distiller rewrites `.roro/PROFILE.md` (<150 lines) post-turn | `.roro/PROFILE.md` writer (off critical path) | Claude Code / Codex read the mirror → reference a Roro-taught fact with zero config | Test: a taught fact appears in `PROFILE.md` within the size cap; a `Forget` removes it from the file |
| **D — Voice behind the seam (ONE backend)** | `VoiceBackend` interface; **`VapiBackend` only** (server-hosted assistantId); delete inline-LLM + ngrok/proxy path; `micMeter.ts` ear-perk; `setEarPerk`; one-voice narration; 45s timeout | `voice/index.ts`, `wireBackendEvents`, `voice/micMeter.ts` (new), `CharacterDriver.setEarPerk` | Say "Roro, fix the test" → ears snap up <80ms → answers in its own voice having run the agent | Integration: spoken "fix the test" produces `CH.turnRun` **and** executor `run.started` (proves it routes through the one brain, never speech-to-speech) |
| **(deferred, not a committed phase) — Moat hardening** | Typed `profile_fact` (confidence/support/supersede) + async distiller; 4-tool MCP server; "What Roro knows…" panel; MoodCore/Bond | new files | week-3 warmth; cross-tool MCP | Built only once C1/C2 retention is observed |

---

## 6. EXPLICIT CUTS / NON-GOALS (YAGNI for 2 people — now cutting real pillar surface, not just dead code)

- **MoodCore `{valence,energy}` + setMood + per-frame modulation, Bond integer, `bond.json`, wake-stretch greeting tiers** — CUT from the committed plan. Soul-polish with zero leverage on the magic line; Tamagotchi-adjacent risk. Transient terminal cues (green hop / comfort posture) cover the felt soul at zero persistence cost. (Scope/Coherence.)
- **The 4-tool MCP server + `MemoryDistiller`-as-sole-promoter + `source_agent` append-only protocol + typed `profile_fact` confidence engine** — DEFERRED past the wedge; the `.roro/PROFILE.md` mirror proves "across them" at ~zero integration. The MCP tool names are an irreversible external contract; don't freeze them before the moment retains. (Scope.)
- **Two of the three voice backends** (OpenAI-Realtime, Pipecat-local) — CUT. Ship one (`VapiBackend`, the working server-hosted branch). OpenAI-Realtime is speech-to-speech (the dangerous substrate) and was wrongly recommended as default. The seam is kept; the integrations are not. (Scope/Coherence/Feasibility.)
- **Native Menu ≡ Tray ≡ ⌘K command surface** — CUT from the committed plan. Right-click=mute suffices; a Menu lands only if users ask where Quit/Sleep are. (Scope/Conflict 4.)
- **Destructive Tier-2** (Claude `--permission-prompt-tool` mid-run approval) + the `getExecutor` capability-routing table — CUT. Tier-1 pre-flight + clean-tree covers the mishear case. (All three lenses.)
- **`setEnergyOverride` / manual Sleep/DND** — CUT. The energy model stays pure; no override branch until a surface (Menu) that needs it exists, which is itself cut. (Scope/Every-Click.)
- **Session resume** (`resumeId`, `codex exec resume` / `claude --resume`) — DEFERRED. Iteration-is-a-new-turn is fine until users demand resume; resuming at the wrong time is worse than a cold start. The `Executor` interface stays unchanged for the wedge. (Scope.)
- **No inline-custom-llm proxy + ngrok + per-launch Vapi PATCH** — REMOVED (not finished). Server-hosted Vapi deletes the need; `@ngrok/ngrok` + `express` become unused deps.
- **No `narrateViaLLM` / Vapi `returnToolResult` loop** — a second brain that disagrees with `decide()`. The cat speaks `Decision.narration` only.
- **No plan→replan agentic loop** — one decide→one run→terminal. Iteration is the user firing another turn.
- **No always-on vision** — `capture_screen` stays on-demand single-shot.
- **No PGlite/Postgres swap, no re-embedding job** — build `owner_id` + `fact` on Insforge@Qwen3-Embedding-8B@1536; swap behind the storage-shaped seam only after the moat is felt.
- **No Tamagotchi mechanics** — absence is always free. (The single most important cut.)
- **No hosted accounts / OAuth / Stripe / cloud sync / multi-device** until post-PMF; `owner_id` stays on-device.
- **No click-through silhouette hit-testing** — but the Ask box gets an explicit pointer-events box so it doesn't punch an opaque hole in the transparent window outside its own bounds.

---

## 7. OPEN FORKS FOR THE FOUNDER

1. **Voice substrate when D ships.** *Recommendation:* **server-hosted Vapi (`vapiAssistantId`) — the only path that works today and the cheapest route to a singing demo.** Do NOT default to OpenAI-Realtime (speech-to-speech, the substrate Risk 2 warns against) or Pipecat-local (heavyweight, contradicts garnish-not-moat). The seam allows a later swap; ship one. *(Reverses the draft's Pipecat-default recommendation per Scope/Coherence.)*
2. **Memory hosting.** *Recommendation:* **local-only `owner_id` through the wedge.** Device-local delivers ~90% of the felt moment; hosted sync (same contract, later) is monetization, not wedge. Mint `owner_id` now so hosting is never foreclosed.
3. **Single Roro vs per-project.** *Recommendation:* the thin `fact` rows are written under `owner_id`; when the typed engine lands, `scope:'global'|'project'` distinguishes language/test-runner prefs from per-repo conventions. The mirror lives at `<repo>/.roro/PROFILE.md`. No rigid decision needed now.
4. **Confidence thresholds for surfacing.** *Recommendation:* in the thin wedge, the extractor's **null-when-unsure** IS the gate (no row → nothing to surface). The `conf≥0.6 ∧ support≥2` gate arrives only with the deferred typed engine. Bias strict: a silent cat beats a wrong one.
5. **Idle-silence voice timeout.** *Recommendation:* **45s** with a soft T-10s "still there?" and an "I'll be here" sign-off.
6. **Resume.** *Recommendation:* **deferred entirely** (see Cuts). Revisit only when users ask Roro to "keep going" on the previous run and a cold start visibly disappoints.

---

## 8. TOP RISKS

1. **The recalled fact is wrong/generic → breaks "it knows me" worse than no memory.** *Mitigation:* the extractor returns `null` when unsure (write no row); every fact is one click from Forget; user correction supersedes. *A silent cat beats a confidently-wrong one.*
2. **A speech substrate answers conversationally and bypasses `turnRun` (the deepest existing bug).** *Mitigation:* the one shipped backend is configured STT+TTS-only; **no speech-to-speech model is attached** (this is why OpenAI-Realtime is rejected as default). Integration test: spoken "fix the test" must produce `CH.turnRun` AND executor `run.started`.
3. **Codex can't be intercepted mid-command.** *Mitigation:* be honest — Tier-1 pre-flight covers the mishear→destructive-*task* case at the only seam Codex exposes; require a clean git tree before a confirmed-destructive run; **Tier-2 is cut.**
4. **`turnRun` return-contract change (resolve at dispatch) breaks existing callers.** *Mitigation:* this is a deliberate, enumerated change (Pillar III); the console `#prompt-form` and bootstrap `turnInFlight` are migrated to drive lifecycle off the push stream in the same Phase-B/C1 change. The PREEMPT E2E test is the regression net.
5. **`owner_id` rescoping breaks the demo / `owner.json` corruption silently orphans memory.** *Mitigation:* keep `session_id` on every row; recall `owner_id`-primary; **atomic write + loud-fail (never silent re-mint)**; the launch-A-write/launch-B-read fixture proves the moment before it's demoed. The SQL migration (drop/recreate `match_memory`) is a deploy step, scheduled and budgeted in A.5 — not an edit-and-rebuild.
6. **The floating body can't be reached (`#overlay` is `display:none`).** *Mitigation:* `#floating-ask`, the Stop pill, and the confirm chip are NEW elements OUTSIDE `#overlay`, each with its own pointer-events box and a target-aware canvas gesture handler — never un-hide the overlay. Hard cross-pillar dependency every floating affordance inherits.
7. **Scope creep back toward voice / MoodCore / the MCP engine because they're seductive.** *Mitigation:* §6 now *cuts* them, not just sequences them — "Phase E" is gone as a euphemism for "never." Re-read each diff against the north star ("typed turn that remembers across launches"). The Zuhn organic-pull thesis confirms the silent always-applicable memory is what retains, not the demo-loud microphone.
8. **Two timers governed terminal decay.** *Mitigation:* unified into one place (driver/state-machine) at one value (~3s) in C1; the `avatar.ts` duplicate is deleted.

---

## 9. WHAT CHANGED FROM THE DRAFT (and why)

**Critical wiring fixes (the draft's mechanisms didn't survive the real code):**
- **`turnRun` now resolves at dispatch, not at terminal.** The draft's renderer-side "cancel-then-start" PREEMPT loop was *unwireable* — `turnRun` blocks for the whole run (`orchestrator.ts:290`, `bootstrap.ts:226`) and `turnInFlight` early-returns, so the renderer had no execution context to receive a barge-in. Split the contract; drive lifecycle off the existing push stream. *(Feasibility + Coherence, CRITICAL.)*
- **Destructive confirm is a specified request/response IPC pair**, not a `PAUSE`. Added `CH.confirmRequest` (push) + `CH.confirmResolve` (invoke) + a `pendingConfirms` Map with a 15s default-deny, sitting in `actOnDecision` *before* `dispatchExecutor`. Acknowledged as new IPC plumbing. Confirm is **explicitly NOT an ActionEvent**, which is what makes "re-freeze the union after `status`" honest. *(Feasibility + Coherence, CRITICAL.)*
- **Pre-executor preempt added (`cancelTurn`).** Barge-in during recall/decide had no `AbortController` in `activeRuns`; added an abort flag checked at the decide boundary. *(Feasibility/Every-Click — the Ask×thinking pair was undefined.)*

**Honesty / coherence fixes:**
- **The magic moment is now staged as recall of a *prior-session* fact** (taught last session, read this session), not extraction on the demoed turn — the draft's "you never configured this, one sentence" obscured the teach→recall arc. Cold-start (first-ever turn, no facts) narration specified. *(Coherence, MAJOR.)*
- **`setListening` renamed `setEarPerk`** to resolve the collision with the canonical `listening` AvatarState (set only by the voice call lifecycle). The typed path never enters `listening`. *(Coherence, MAJOR.)*
- **The "Remembering" cue is re-sourced off the new `status.kind:'recall'` typed field**; the `text.startsWith('Insforge memory')` sniff in `activityForEvent` is deleted (the draft assumed it was already decoupled — it isn't). *(Coherence, MINOR.)*
- **The `status`-kind change is enumerated as a 5-site ripple + fixture** (delete sniff, migrate 2 beats not `emitNarration`, add to `memoryKind` skip list, confirm `eventToAvatarState` needs no edit), not "one line." *(Feasibility, MINOR.)*
- **A.5 now includes the hosted-Insforge SQL migration** (add column + drop/recreate `match_memory` with `p_owner_id`, keep `p_session_id`) as a deploy step — the draft sold it as ~20 lines of TS. The "second machine" test is corrected to **same-device cross-launch** (per-device `owner_id` isolates machines). *(Feasibility, MAJOR ×2.)*

**Scope cuts (sequencing-to-"Phase E" was a euphemism for never):**
- **CUT: MoodCore + Bond + greeting tiers** (zero wedge leverage, Tamagotchi risk).
- **CUT: 2 of 3 voice backends** → ship one working Vapi; OpenAI-Realtime rejected as the speech-to-speech substrate Risk 2 warns against.
- **CUT: native Menu/Tray/⌘K** → right-click=mute suffices.
- **CUT: destructive Tier-2 + capability routing; `setEnergyOverride`/DND; session resume** (all speculative for the wedge).
- **MCP server / typed profile engine DEFERRED past the wedge**; `.roro/PROFILE.md` mirror proves "across them" at ~zero integration. *(Scope, MAJOR.)*

**Missing-interaction fills:** Ask×thinking (cancelTurn), mid-run submit inverts the `turnInFlight` guard, confirm-chip full matrix row (pet allowed, Esc=deny, occlusion=auto-deny, poke suppressed), Stop pill subscribes to the stream directly, summon-on-visible doesn't poke, empty-Enter checks before the pose, sleep-curl pose suppressed by `busy` during long runs, `owner.json` atomic-write/loud-fail, unified terminal-decay timer, optimistic-local-pose stated for the ≤16ms budget. *(Every-Click + Coherence.)*

---

This is the spine. Build **A.5 → B** first — they unlock the magic moment with zero voice risk, the one un-retrofittable schema change (with its SQL migration), and the corrected `turnRun` contract that makes everything downstream wireable. **C1 (reliability) → C2 (mirror)** earn the bond and the cross-agent claim. Voice (D) and the typed/MCP moat engine are honest fast-follows. Everything hangs off the seams above without touching the re-frozen ActionEvent union, the 6-state mapper, or the single `turnRun` chokepoint — whose return contract is now the one deliberate, tested change.
