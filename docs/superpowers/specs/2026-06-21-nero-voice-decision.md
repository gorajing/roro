# Roro Voice: Lead Architect's Synthesis & Recommendation (Hardened v2)

*One coherent ruling, reconciling four evaluations and three adversarial reviews. Where the draft asserted finished work that the repo does not contain, the claim is corrected to "unbuilt prerequisite" and re-costed. Every concrete vendor number is normalized to a single metric or marked unbenchmarked. Code-grounded claims cite the file.*

The four evaluations converge on three load-bearing invariants: **mouth-not-brain** (every spoken turn routes through the one `turnRun` chokepoint), **summon-not-ambient** (no always-on mic), and **memory-first** (voice rides on top of recall→decide→remember, never around it). They diverge on *which substrate* and *where voice inserts in the build order*. This document rules on both — and, critically, corrects the draft's central factual error: **the mouth-not-brain invariant is not yet satisfied in the shipping code; it is violated by the default path.**

---

## 1. THE VOICE THESIS

Voice is the **embodiment of "beyond chat" — the way you *direct* Roro — but it is not the moat; the moat is memory.** Voice's job is to make that memory feel like a colleague who knows you, not a chatbox with a face. Concretely, "beyond chat" means Roro is a **voice-forward, type-default ambient collaborator**: you steer a long-running agent by *talking* to a creature that watches your work and remembers you across launches, and you fall back to silent typing when the room demands it — and the *same* memory-grounded brain answers either way.

**The magic moment (one line):** *You say "Roro, fix the failing test like last time" — its ears snap up before any network, and it answers in its own voice with a plan that recalls what you did last week, then does it.*

This thesis is unchanged from the draft. What changed is the honesty about how far the code is from delivering it (Section 8).

---

## 2. INTERACTION MODEL

**Posture: voice-FORWARD, type-DEFAULT.** Typing is the silent, open-office-safe **default** — the floating Ask input, always present, never embarrassing, a true peer front-door. Voice is the **summoned directing channel** — the steering centerpiece when you're alone and a run is long. Both are **peer front-doors into the same `turnRun` chokepoint** (input parity): the silent path loses nothing — same recall, same `Decision.narration` reply, rendered as a caption instead of speech.

**Summon, never ambient (hard rail, unanimous).** Always-listening is *disqualified*: it violates the near-zero-idle product law and the open-office trust bar (a hot mic layered on a memory dossier is an uninstall trigger). Voice opens on a **deliberate, labeled summon** with a visible "listening" tell; the mic window auto-closes at **45s of silence** (soft "still there?" at T-10s). Three peer summon paths, all entering one visible MODE:

1. **Global hotkey** — the v1 default.
2. **Deliberate click-to-talk on the cat body** — never the timing-based hold-to-talk that caused billed-by-accident churn (that path stays deleted).
3. **Edge wake-word** (opt-in, post-v1) — runs entirely on-device.

> **Ruling on Eval 3's opt-in "ambient mode" (resident RMS+VAD loop): cut from v1.** Push-to-talk summon is the entire v1 surface; an edge-only wake-word is the post-v1 affordance if users ask.

**The cat maps onto the existing 6 canonical AvatarStates — we do NOT invent a 7th.** Confirmed in `wireEvents.ts` (lines 7–18): there is no `talking` AvatarState; assistant speech toggles `CharacterDriver.setTalking(true/false)` and keeps the avatar in `listening`. Eval 3 was right; we follow it.

- **Ear-perk → `listening`**: fire `driver.poke()` + ear-perk **before any network or STT result**. **This requires a renderer-held `getUserMedia` RMS tap that does not exist today** (no `micMeter.ts`, no `setEarPerk` — grep-confirmed zero) and is a build item, not a seam (Section 4, Section 8). Target **≤150ms** local actuation (see latency note — sub-80ms is an actuation budget, not a guarantee).
- **`thinking`**: driven by the brain's `onReasoning` push while `decideStreaming` runs (`orchestrator.ts:176`).
- **Speaking**: `setTalking(true)` layered over the current state, with `volume-level`-driven lip-sync (`wireEvents.ts:71`) — the cat speaks `Decision.narration` only.
- **`working`/`done`/`error`**: driven by executor `ActionEvent`s as the typed path already does.

**Barge-in (full-duplex).** **D.2 only.** In D.1 (hosted Vapi) barge-in is *Vapi's hosted interrupt*, not a local sub-frame stop — measure it; expect **~200–500ms incl. network**. A true **local <120ms TTS-duck actuation** requires the renderer-held edge VAD that ships in D.2. The draft's "<120ms all local" is a D.2 property and has been removed from the D.1 budget.

**Confirm safety (non-negotiable, and currently UNBUILT).** A spoken "yeah" must **never** approve a destructive run. **The confirm channel does not exist** — `ipc.ts` (line 11) has only `turnRun / runTask / cancelTask`; there is no `confirmResolve`, no clean-git precondition, no destructive pre-flight (the only `preflight` in the repo, `brain/index.ts:92`, is an LLM-readiness check, not an action gate). This is a **blocking prerequisite to build**, specified in Section 4 — not a rail to "gate behind."

---

## 3. SUBSTRATE RECOMMENDATION

### The ruling: ONE facade, TWO backends, staged — hosted-first, owned-as-the-strategic-target. Reject LiveKit and OpenAI Realtime.

But with the **D.2 commitment demoted from "non-negotiable fast-follow" to "explicitly optional, post-PMF"** (the seam is committed; the local backend's calendar is not — see Section 6 #2). For a 2-person team, committing two from-scratch flaky integrations contradicts our own anti-over-scope rule.

**Backend #1 (D.1, ships first):** **Server-hosted Vapi via custom-LLM-endpoint pointed at `turnRun`.** *Correction to the draft:* Vapi is a three-stage Listen→Think→Speak orchestrator; the Think stage is **not deletable** — Vapi requires a model leg to run a call. The supported "pure transport" pattern is **custom-LLM**: Vapi POSTs the transcript to *your* endpoint and speaks back the text your endpoint returns. So the correct D.1 architecture is: **make `turnRun` the custom-LLM endpoint that returns only `Decision.narration`** — not "delete the LLM stage." The current code already points `model.provider:'custom-llm'` at a Nebius proxy (`vapiClient.ts:54–70`) that bypasses `turnRun` — that is the bug to fix, not the model to delete (Section 4).

**Backend #2 (D.2, optional, post-PMF — the ownable tier):** Local hybrid behind the *identical* facade. **None of these are installed** (`package.json` has only `@vapi-ai/web ^2.5.2`; daily-js `^0.85.0` rides under Vapi) — this is a second voice project, not a fill-in:
- **Ears (VAD/barge-in):** **Silero VAD v5** (MIT, ~2MB ONNX via onnxruntime-web/WASM) in-renderer. *Correction:* per-frame inference is single-digit-ms, but **semantic end-of-turn requires a hangover/silence window (~200–700ms)** — Silero is a frame-level speech-probability VAD, not an endpointing model. The turn-detection latency is dominated by the silence threshold, not inference.
- **STT:** **Deepgram nova-3 streaming** for the partial/low-latency path; **whisper-large-v3-turbo** (Apple Silicon) for an optional high-accuracy *final* pass. *Correction:* whisper-large-v3-turbo is a **batch/chunked** model; the ~10x-realtime figure is throughput on a finished clip, **not** end-of-speech-to-final latency. Honest budget: chunked whisper end-of-speech→final on Apple Silicon is **~300–800ms+** (dominated by the VAD silence window + a final decode), not sub-200ms. If sub-200ms partials matter, they come from streaming Deepgram, not whisper.
- **Brain:** the **existing Nebius/`decide()` chokepoint — unchanged.**
- **TTS:** **Cartesia Sonic (~75–90ms streaming-TTFB over WebSocket)** or **ElevenLabs Flash v2.5 (~150ms end-to-end; 75ms is inference-only, not a peer to Cartesia's network-inclusive number)** as the hosted "pretty voice"; **Kokoro-82M** (Apache-2.0) ONNX/WASM as the local-default mouth — but its **TTFA is unbenchmarked on WASM-in-renderer and will plausibly exceed 200ms; measure before committing it as the latency-floor default.** The draft's "Kokoro sub-200ms" was unsourced and is withdrawn.

**Why this fits the constraints** (with the idle correction):

- **Voice-as-core / ownable:** routing the user's mic + relationship through someone else's media server is *rented*. The moat stays a moat only if the mouth is swappable down to fully-local. The facade lets the owned tier mature behind the seam without blocking the demo (KB: organic-pull/local-first dev tools retain 70%+, PRED-260325-2393; "own the strategic substrate, rent only swappable plumbing" = vertical-unbundling applied to the stack).
- **Reliable:** the **typed path (already shipped) is the true reliability floor** — *not* hosted Vapi. Vapi is a fallible voice layer on top, with real external moving parts (Section 6 #5).
- **Near-zero-idle — corrected:** "no SFU, no always-warm socket" is **false for D.1.** Hosted Vapi rides `@daily-co/daily-js` (a WebRTC SFU); while a call is on, it holds a **warm Daily/WebRTC leg for the entire call**, and `framePolicy.ts:24` pins **60fps for the whole `inCall` window** — including the 45s post-utterance silence and any long run. That is near-**max**-cost during summon-and-wait, not near-zero. **Two product laws, distinguished:** the *no-always-on-mic* law is satisfied by D.1; the *compute/cost-idle* law is satisfied **only by D.2** (no SFU, WASM in-renderer). Fix in Section 4: split `framePolicy`'s `inCall` branch so 60fps applies only while `setTalking || userVadActive || busy`, else fall to the existing 12fps drowsy tier.
- **Mouth-not-brain (structural):** the `VoiceBackend` interface has **no "generate response" method — only `say(exactText)`** — so it cannot grow a second brain.

**Rejected, with corrected reasons:**

- **LiveKit — 3/10.** Lead reason is **topology/idle-cost**: SFU + agent worker + token server = non-zero idle, the real disqualifier for a 1:1 pet. (Soften the SDK point: the Node/agents-js SDK is *younger*, not a clean loss — it has turn detection, noise cancellation, MCP-era features in 2026. It is not the load-bearing reason.) Note: the topology objection applies to hosted Vapi's transport too — both are warm-for-the-call SFUs. Vapi's advantage is *managed*, not *idle-free*.
- **OpenAI Realtime (speech-to-speech) — disqualified.** *Stale claim cut:* the draft's "still fails at reliable tool-calling" was true of the Oct-2024 preview but **wrong in 2026** — `gpt-realtime` went GA (Aug 2025) advertising precise tool calls, async/parallel function calling, and remote MCP. The rejection re-anchors **purely on the architecture that is still true**: s2s makes the model the brain, bypassing `decide()`/recall/remember — the exact moat-bypass mouth-not-brain forbids. This argument needs no tool-calling claim and survives the GA release.
- **Pipecat — borrow design, not runtime.** Its **server pipeline is Python** (the real reason to avoid embedding it: a Python sidecar to package/sign/crash-recover in Electron). Its **client SDK (`pipecat-client-web`) is JS-native** — so "borrow the architecture" specifically means avoiding the Python *server* process, not all of Pipecat. We adopt its frame-pipeline blueprint (the Silero/Deepgram/Cartesia component shape) in our hybrid.

---

## 4. WIRING — Control Flow

The draft claimed "80% correct; deletion plus three seams." **That is wrong and is the most dangerous error to leave standing.** The shipping default path is the moat-bypass bug, and the reliability layer voice depends on is unbuilt. The honest framing: **fix the live two-brain bug first, then build a net-new cancel/confirm/abort layer, then add voice.**

### 4.0 The live bug to fix FIRST (its own CI-gated step, before any sequencing call)

When `vapiAssistantId` is empty (the **default** — `config.ts:70`), `startCompanionCall` starts the inline `buildAssistant` whose `model.provider:'custom-llm'` points at the Nebius proxy (`vapiClient.ts:54–70`). Vapi runs its **own** STT→Nebius→TTS loop and speaks a reply, **while `turnRun` fires in parallel** off the final transcript (`wireEvents.ts:81–92`). **Two brains.** The one that speaks never calls `recallContext`/`decide`/`remember`.

Fix, in order:
- **(a)** Reconfigure the assistant so its custom-LLM endpoint **is `turnRun`** (Vapi POSTs transcript → your endpoint returns only `Decision.narration` text). Do **not** "delete the model leg" — Vapi requires one; that path would block the demo. **First verify** against Vapi docs whether a no-LLM transport assistant exists; if not, custom-LLM-as-`turnRun` is the only supported pure-transport shape — write that finding down.
- **(b)** Delete `narrateViaLLM` and `returnToolResult` (`voice/index.ts:107–125`) — both `send` an `add-message` with `triggerResponseEnabled:true`, each a live second-brain trigger.
- **(c)** Strengthen the CI guard to assert **NOT ONLY** "`turnRun` + executor `run.started` fire" but **ALSO** "zero assistant model-output / zero `/chat/completions` hits during a spoken turn." The draft's guard would *pass while the custom-llm assistant also speaks in parallel* — it proves the brain ran, not that the second brain is silent.

### 4.1 Happy path (after 4.0 lands)

```
[EDGE / renderer]   ← NET-NEW in D.2; in D.1 Vapi owns the mic
  getUserMedia → AnalyserNode RMS  (micMeter.ts — UNBUILT)
    └─ RMS rising edge → driver.poke() + setEarPerk(true) + setState('listening')
         local actuation, BEFORE any STT token   ← see ear-perk note below
  audio → Silero VAD (D.2) → streaming STT (Deepgram nova-3 / Vapi-hosted in D.1)
    └─ partials → captions.update(role='user', isFinal=false)
  VAD semantic end-of-turn (silence-window-dominated) → FINAL transcript

[CHOKEPOINT — the one brain]
  turnRun({ transcript, sessionId })   ← in D.1 this IS Vapi's custom-LLM endpoint
    → runTurn (orchestrator.ts:253):
        recallContext  → rememberUserSaid → decideStreaming → Decision
    ★ PHASE-DISPATCH REFACTOR (UNBUILT): runTurn currently AWAITS actOnDecision
      (orchestrator.ts:290) and returns {runId} only. Resolve-at-dispatch returning
      {runId, command} is a real refactor of the primary entrypoint, not a seam.

[OUTPUT]
  answer/clarify → emitNarration → backend.say(Decision.narration) (orchestrator.ts:311)
  run_agent      → emitNarration → dispatchExecutor → ActionEvents → 'working' → terminal
  EVERY meaningful event → memory.remember (orchestrator.ts:218)
```

**The cat NEVER speaks anything that isn't a `Decision.narration` string or a narrated `ActionEvent`.**

**Ear-perk latency — corrected.** "<80ms" is an *actuation* budget (the local draw call), not a detection guarantee: the *trigger* is a tunable RMS/VAD-confidence threshold plus a debounce to avoid firing on a cough. State it honestly: **local actuation target ≤150ms; the detection delay is a tuned threshold, not a fixed sub-frame number.** The architectural point stands — it must not wait on cloud STT — but that property **only exists in D.2** (renderer-held mic). In D.1, Vapi owns `getUserMedia`; either the renderer runs a *parallel* RMS tap alongside Vapi's stream (verify the SDK permits a second mic consumer), or **the <80ms-local ear-perk gate is dropped from D.1** and the headline waits for D.2. Pick one and write it down (Section 6 #1).

### 4.2 Barge-in (requires the dispatch refactor + an abortable decide)

```
while setTalking(true) OR run in flight:
  edge VAD (D.2) → sustained user energy mid-speech
    → (1) backend stop-TTS                  [D.2: local duck; D.1: Vapi hosted interrupt ~200–500ms]
    → (2) cancelTurn(runId)  ← UNBUILT IPC channel:
            abort the in-flight decide() AbortController
            AND cancelTask(runId) → SIGTERM executor child
    → (3) re-enter listening path
```

*Correction:* `cancelTurn` does not exist, and **`decide()` is not abortable today** — only `dispatchExecutor` creates an AbortController (`orchestrator.ts:199`); `runTurn`/`decideStreaming` have none. So "cancelTurn aborts the in-flight decide() AbortController" aborts a controller that was never created. Build item: **thread a signal into `decideStreaming`/`runTurn`, register it in `activeRuns` under `runId` at turn START (not only at executor dispatch)**, and have `cancelTurn(runId)` abort whichever phase is live.

**Two distinct cases (the draft collapsed them):**
- **(a)** user speech over assistant TTS → barge-in/preempt (above).
- **(b)** a **new final transcript during a silent in-flight `run_agent`** (no TTS to barge into) — today `wireEvents.ts:84` silently *drops* it (`turnInFlight` guard). Define explicit behavior — **preempt-and-restart via `cancelTurn`, or queue** — and add a headless test for (b). Do not leave it under the deleted drop-guard, or you re-create "it ignored my second instruction" on the prominent surface.

**Cancel-race hygiene:** tag `ActionEvent`s with a generation/epoch id (none exists today); drop events from a superseded `runId` at the renderer; swallow the specific `run.failed('aborted')` terminal for a cancelled turn rather than flashing `error`.

**Idle gating (the fix):** split `framePolicy`'s `inCall` branch so **60fps only while `setTalking || userVadActive || busy`, else fall to 12fps** — instead of pinning 60 for the whole call. VAD/STT/TTS instantiate only while Talk is on; teardown on toggle-off or 45s silence. Audio is never persisted — only derived transcript text flows.

### 4.3 Confirm safety — a BLOCKING PREREQUISITE to build (not a finished rail)

New IPC surface to add to `CH`: **`confirmRequest`** (main→renderer push) + **`confirmResolve`** (renderer→main invoke), a **15s default-deny timer**, and a **clean-git-tree precondition** on Tier-1 destructive ops. Invariant: **a voice-originated `turnRun` sets `source='voice'` on the Decision, and `confirmResolve` REQUIRES a non-voice action (click/keypress) when `source='voice'`** — a spoken "yes" can never resolve a destructive confirm.

### 4.4 The CI guards that protect the moat (RUN them, don't code-read them)

1. Spoken *"fix the test"* → `CH.turnRun` **AND** executor `run.started` **AND zero assistant model-output / zero `/chat/completions`** during the turn.
2. Spoken affirmation cannot resolve a destructive confirm — feed a synthetic final-transcript "yes" while a destructive command is pending; assert the run does **not** start. (Repro-first: write this failing test before the confirm code.)
3. `cancelTurn` mid-`decide` aborts the stream — start a turn, fire `cancelTurn` mid-decide, assert no narration/`run.started` follows.

---

## 5. REVISED SEQUENCING

The draft sequenced against **phases (A.5 / B / C1 / C2) that appear in no plan in this repo** and cited a lock "dated 2026-06-21" — which is **today**, circular provenance. `PRODUCT_PLAN.md` uses a different taxonomy: **Pillars** (Soul / Memory / Growth / Presence / HostedExecutor) with phase numbers and "v1 cut / Defer" lists. Re-anchored to the real plan:

### Ruling: voice ships AFTER (1) owner-scoped memory recall is green headless, AND (2) a net-new cancel/confirm/abort-decide/dispatch-refactor reliability layer is built and tested headless. Voice gains stature and a committed phase — but its true cost is the reliability layer it depends on, which does not yet exist.

**The draft's "voice after C1, leapfrog C2" is unactionable** — there is no C1/C2 to leapfrog. Stated in real terms, voice's hard dependencies are:
- **Owner-scoped memory recall.** *Correction to the memory-first proof:* `memory.recall` is scoped by **`session_id` only** (`orchestrator.ts:153`; `memory.ts:3`), and **`owner_id` exists nowhere in `src`** (it is a PRODUCT_PLAN "v1 cut" under HostedExecutor). The draft's proof fixture — "fact taught in launch A, recalled in launch B, **fresh session_id**, same owner_id" — **cannot pass today**: a fresh session_id recalls nothing. Either the fixture **reuses the same sessionId** (contradicting "fresh"), or **owner_id-scoped recall lands first**. The "green demonstrable moat before voice" milestone is itself blocked on this — surface it as a prerequisite, not a given.
- **The reliability layer (Section 4.2–4.3): all net-new.** `cancelTurn`, the confirm channel, the clean-git precondition, the abortable `decide`, the dispatch-return refactor, and a Stop watchdog/SIGKILL — **none exist** (grep-confirmed). So "pull voice earlier because it reuses the reliability machinery" is backwards: pulling voice earlier **forces building that entire layer earlier**, which is exactly the "two flaky integrations in parallel" the draft forbids.

**Why not earlier than memory.** Voice on top of nothing is a party trick; the spoken reply only feels like a colleague because it recalls you. KB-decisive: durable retention comes from the silent memory loop (organic-pull 70%+, PRED-260325-2393), not demo-loud commodity voice. And memory is provable **fully headless** (a vitest cross-launch fixture, scoped correctly per the correction above) — reach a green moat without fighting `getUserMedia`/WebRTC first.

**The one safe parallelization — a genuinely pure-TS, headless seam in the memory phase:**
- The `VoiceBackend` one-method-speech interface (`connect`/`onUserTranscriptFinal`/`onVolume`/`say(exactText)`/`setMicMuted`) — a two-implementation contract (because we *intend* two real backends), defined now.
- `CharacterDriver.setEarPerk` added to the facade (pure facade addition).
- The **dispatch-return refactor** of `runTurn` (`{runId, command}`) — independently valuable, a hard prerequisite for barge-in, and pure-TS.

**Do NOT build memory and full voice concurrently.** Splitting a 2-person team across pgvector/owner_id **and** mic/STT/WebRTC ships both half-done. The seam above is the only overlap that's safe because it's headless.

### Minimum reliable first-class voice slice — re-cut to be actually minimal

The draft's "minimum" bundled 6–7 net-new integrations (several against Vapi's grain). True minimum, sequenced as increments:

- **D.1a (prove the chokepoint):** push-to-talk summon → Vapi STT final transcript → **the fixed `turnRun` custom-LLM endpoint** → **caption `Decision.narration` as TEXT (no TTS yet).** Green CI guard #1 (including zero second-brain output). This proves mouth-not-brain with the smallest surface.
- **D.1b (the cat speaks):** add `backend.say(Decision.narration)` once the say-text path is proven against Vapi (a non-trivial integration, not a deletion).
- **D.1c (barge-in):** only after 1a/1b land; in D.1 this is Vapi's hosted interrupt latency, measured and stated.
- **Local ear-perk, local <120ms barge-in, offline pipeline:** **D.2**, optional/post-PMF.

### The reliability bar voice must clear before it becomes the headline (RUN it)

1. CI guard #1 green (turnRun + run.started + **zero second-brain output**).
2. Stop is provably terminal under barge-in (build the watchdog/SIGKILL — currently `cancelTask` only calls `AbortController.abort()`, `orchestrator.ts:419`).
3. A spoken word can **never** approve a destructive task (CI guard #2; confirm channel built).
4. Ear-perk fires locally independent of cloud STT — **achievable only when the renderer holds the mic (D.2), OR explicitly dropped from the D.1 gate** (Section 6 #1).
5. A **clean-Mac install completes one full spoken turn** — observed running, not asserted from code.

Until these hold, the headline stays *"the coding pet that remembers you,"* with voice as the way you talk to it.

---

## 6. OPEN DECISIONS FOR THE FOUNDER

1. **Does voice's first-class slice (D.1) require the local <80ms ear-perk, or not?**
   → **Decide explicitly — you cannot have it both ways.** Vapi owns `getUserMedia` in D.1, so either (a) the renderer runs a **parallel RMS tap** alongside Vapi (verify the SDK allows a second mic consumer) and keeps the gate, or (b) **drop the local-ear-perk gate from D.1** and accept a cloud-dependent perk until D.2. *Recommend (b): drop it from D.1, make local ear-perk the headline-qualifying property of D.2.* Honest, and keeps D.1 small.

2. **Commit the owned local hybrid (D.2) to the calendar, or keep it a seam-only option?**
   → *Recommend: commit the SEAM now (cheap, pure-TS); make the D.2 backend explicitly optional, post-PMF.* The KB local-first retention thesis requires **not foreclosing** the local tier — which the seam alone achieves — not shipping it in v1. Committing two from-scratch flaky integrations for two people contradicts our own risk #6. Revisit once D.1 has shipped and retained.

3. **Default voice quality: local Kokoro or hosted "pretty voice"?**
   → *Recommend: paid/online tier defaults to the hosted voice (Cartesia/ElevenLabs); local voice is the privacy/offline floor.* Same `say()` contract — a config default, reversible. **But measure Kokoro WASM TTFA before relying on it as a latency floor.**

4. **Wake-word (edge-only) post-v1, or hotkey-only forever?**
   → *Recommend hotkey-only for v1; revisit edge wake-word post-launch only if users ask.* Keeps near-zero-idle and privacy airtight. Not a now-decision.

5. **How loud is voice in the launch GTM story?**
   → *Recommend: "remembers you" is the headline; "you talk to it" is the hero demo.* Lead with the moat, demo with the soul. KB: retention follows memory.

---

## 7. RISKS THAT COULD SINK IT

| # | Risk | Mitigation |
|---|------|-----------|
| **1** | **Second brain is the LIVE DEFAULT** — inline custom-llm assistant (`vapiClient.ts:54`) speaks from Nebius while `turnRun` runs in parallel (`wireEvents.ts:81`). This is shipping, not hypothetical. | Fix 4.0 as its own CI-gated step *first*: point Vapi's custom-LLM endpoint **at `turnRun`** (Vapi needs a model leg — don't delete it); delete `narrateViaLLM`/`returnToolResult`; CI guard asserts **zero second-brain `/chat/completions`** during a spoken turn (the draft's guard would have passed while both brains spoke). |
| **2** | **OpenAI Realtime seduction.** Natively s2s; in 2026 its tool-calling is GA-good, making it *more* tempting. | Reject on the architecture that's still true: s2s = model-is-brain = bypasses recall/decide/remember. `VoiceBackend` has only `say(exactText)`, no generate. (Cut the stale "tool-calling is broken" justification.) |
| **3** | **Barge-in can't cancel** — `runTurn` awaits to completion (`orchestrator.ts:290`); no `runId` mid-flight, and `decide()` has no AbortController. | Build the dispatch-return refactor (`{runId, command}`) AND make `decide` abortable (register signal in `activeRuns` at turn start). `cancelTurn` aborts whichever phase is live. Headless test #3. |
| **4** | **Mishear → `rm -rf`** — and the entire safety layer (confirm channel, clean-git, watchdog, destructive pre-flight) is **UNBUILT** (`ipc.ts:11` has only turnRun/runTask/cancelTask). | Treat confirm-safety as a **blocking deliverable**, not a rail to gate behind: new `confirmRequest`/`confirmResolve` IPC, 15s default-deny, clean-git precondition, `source='voice'` ⇒ requires non-voice resolve. CI guard #2 (spoken "yes" cannot approve). |
| **5** | **Hosted Vapi is MORE moving parts, not fewer** — Vapi uptime + Deepgram + ElevenLabs + the **live ngrok/custom-llm proxy tunnel** (`config.ts:73`, the original-sin flakiness in another form) + per-active-minute billing. | Stop calling Vapi the "reliability floor" — the **typed path (shipped) is the floor.** Enumerate each Vapi dependency with a fail-loud banner + typed fallback. Price the per-minute billing. Vapi is a fallible voice layer on top. |
| **6** | **Near-MAX-idle during calls** — Vapi holds a warm Daily SFU leg for the whole call and `framePolicy.ts:24` pins 60fps for the entire `inCall` window incl. the 45s silence and long runs. | Distinguish two laws: *no-always-on-mic* (D.1 satisfies) vs *compute/cost-idle* (only D.2's SFU-free WASM satisfies). Split `framePolicy` `inCall` → 60fps only while `setTalking||userVadActive||busy`, else 12fps. Stop claiming D.1 has "no always-warm socket." |
| **7** | **2-person over-scope** — building memory + two from-scratch voice backends in parallel ships everything half-done. | Sequence, don't parallelize the flaky integrations. Only the pure-TS headless seam overlaps the memory phase. Ship D.1 incrementally (1a text → 1b speak → 1c barge-in). **Demote D.2 to optional/post-PMF.** Borrow Pipecat's architecture, not its Python server. |
| **8** | **Memory-first proof is itself blocked** — recall is `session_id`-scoped (`orchestrator.ts:153`), `owner_id` doesn't exist; the "fresh session_id" cross-launch fixture recalls nothing. | Land owner_id-scoped recall (PRODUCT_PLAN "v1 cut") OR rewrite the fixture to reuse sessionId. Make the green-moat milestone honest about this prerequisite. |

---

## 8. WHAT CHANGED (and why)

- **Reframed "80% correct, deletion plus seams" → "fix a live two-brain bug, then build a net-new reliability layer, then add voice."** Verified in code: the default path (`vapiAssistantId=''`, `config.ts:70`) runs Vapi's own custom-llm Nebius loop (`vapiClient.ts:54`) **in parallel** with `turnRun` (`wireEvents.ts:81`). The mouth-not-brain invariant is *violated by the shipping default*, not merely at risk. This is the single most important correction.
- **Corrected the Vapi D.1 architecture** from "delete the LLM stage, STT+TTS-only" (not a real Vapi config) to **"point Vapi's custom-LLM endpoint at `turnRun`, returning only `Decision.narration`."** Vapi requires a model leg; "delete it" would block the demo.
- **Strengthened CI guard #1** to assert **zero second-brain output / zero `/chat/completions`** during a spoken turn — the draft's guard would have passed while both brains spoke.
- **Demoted confirm-safety, `cancelTurn`, clean-git, watchdog/SIGKILL, abortable `decide`, dispatch-return** from "existing C1 rails to gate behind" to **net-new blocking deliverables** — grep-confirmed absent (`ipc.ts:11` has only turnRun/runTask/cancelTask; `decide` has no AbortController; the only `preflight` is LLM-readiness).
- **Re-anchored sequencing to the repo's real taxonomy** (Pillars + v1-cut/Defer in `PRODUCT_PLAN.md`). Removed the fabricated A.5/B/C1/C2 phases and the circular "locked 2026-06-21" provenance. Voice's real dependencies are owner-scoped recall + the unbuilt reliability layer.
- **Fixed the memory-first proof fixture:** recall is `session_id`-scoped and `owner_id` is absent in `src`, so "fresh session_id, same owner_id" recalls nothing — surfaced as a prerequisite.
- **Cut the stale OpenAI Realtime claim** ("tool-calling still fails"): `gpt-realtime` GA (Aug 2025) fixed it. Rejection re-anchored on the moat-bypass architecture, which survives the GA release.
- **Normalized every vendor latency number to one metric:** removed unsourced "Kokoro sub-200ms" (unbenchmarked on WASM-in-renderer); corrected whisper-large-v3-turbo (batch throughput ≠ ~150–300ms end-of-speech-to-final; honest ~300–800ms+); split ElevenLabs (75ms inference) from Cartesia (~75–90ms network-inclusive WS TTFB); reframed Silero "single-digit-ms" as inference-only (end-of-turn is silence-window-dominated, ~200–700ms); reframed ear-perk "<80ms" and barge-in "<120ms" as **D.2-only local actuation budgets with tuned detection thresholds**, removed from the D.1 budget.
- **Corrected the near-zero-idle claim:** D.1 hosted Vapi rides a warm Daily SFU and `framePolicy.ts:24` pins 60fps for the whole `inCall` window — *not* "no always-warm socket." Split the product law into no-always-on-mic (D.1) vs compute/cost-idle (D.2 only), with a concrete `framePolicy` fix.
- **Demoted D.2 (local hybrid) to optional/post-PMF** and made the D.1 "minimum slice" actually minimal (1a text → 1b speak → 1c barge-in) — two from-scratch flaky backends for two people contradicted the doc's own risk #6; none of Silero/whisper/Kokoro/onnx are installed (only `@vapi-ai/web`).
- **Corrected the LiveKit and Pipecat rejections** to lead with topology/idle-cost (LiveKit) and the Python *server* specifically (Pipecat's client SDK is JS) — softening overstated SDK-maturity claims that a 2026 reviewer would dismiss.
- **Split barge-in into two cases** — over-TTS vs a new final transcript during a silent run (today dropped at `wireEvents.ts:84`) — so the second instruction isn't silently lost.

The synthesis still holds: voice is **first-class, forward, type-default, summon-not-ambient**; substrate is **one facade, hosted Vapi (custom-LLM = `turnRun`) first, owned local hybrid as the optional strategic tier**; LiveKit and OpenAI-Realtime rejected. The headline stays *"the coding pet that remembers you."* The change is honesty about the build: **the moat-bypass is live and must be fixed first, the reliability layer voice rides on is unbuilt and must be costed as real work, and the local-first tier is a committed seam with an optional backend — not a guaranteed v1 fast-follow.**

Key files referenced: `/Users/jinchoi/code/companion/app/src/renderer/voice/vapiClient.ts`, `/Users/jinchoi/code/companion/app/src/renderer/voice/index.ts`, `/Users/jinchoi/code/companion/app/src/renderer/voice/wireEvents.ts`, `/Users/jinchoi/code/companion/app/src/main/orchestrator.ts`, `/Users/jinchoi/code/companion/app/src/shared/ipc.ts`, `/Users/jinchoi/code/companion/app/src/shared/memory.ts`, `/Users/jinchoi/code/companion/app/src/renderer/character/framePolicy.ts`, `/Users/jinchoi/code/companion/app/src/renderer/config.ts`, `/Users/jinchoi/code/companion/PRODUCT_PLAN.md`.
