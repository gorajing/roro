# Roadmap — the living execution plan

> **Status: LIVING execution plan** — how we get from where we are to the vision. Canonical remains
> `../FOUNDING.md` + `../HANDOFF.md` + `../PUBLIC.md`; the vision tier is `PRODUCT_PLAN.md` (the former
> companion-architecture doc was folded into its banner + git history, 2026-07-01) —
> **read as where-we're-going aspiration, *not* execution sequencing.** Where the vision tier reads as
> "build now" (e.g. the bond projection / second soul), **this roadmap's gating (§6 Arc C,
> §8) governs the order**, not its language. This
> doc is **re-planned on real signal, not on a schedule** (§8). Treat everything past **Arc A** as a
> compass bearing, not a commitment. The one metric that governs all of it: **"would a real user grieve
> losing it?"**

---

## 1. Where we are (honest current state)

- **The engine is real and mature.** The core loop works end to end — typed task → recall from
  encrypted local memory → decide (local Ollama 3B) → run a real coding agent (Codex/Claude) →
  remember — behind a safety spine (destructive-confirm, clean-tree *for confirmed-destructive runs*,
  single-executor, Stop), with a
  procedural-cat embodiment. A substantial, near-fully-tested typed codebase, signed/notarized
  tooling, CI.
- **Launch track (`../PUBLIC.md` "Path to Public"):** onboarding (Phase 1) is **landed** and the
  trust-loop **primitives** (Phase 2) are in — but Phase 2's *exit* (a stranger's first turn landing
  correctly or clarifying) still needs **real first-turn validation** (`../HANDOFF.md`).
  "Magic-moment-survives-packaging" (Phase 0) is nearly done (safeStorage half done;
  remaining = a **signed/notarized `.dmg` that clears Gatekeeper with zero warnings on a clean *second*
  Mac**, plus a non-founder seeing a recalled fact **shape actual coding work** — not just survive
  quit/relaunch — `../PUBLIC.md`); the **cohort
  debut (Phase 3) has not started**.
- **Landed** (the companion foundation): pet-state → mood-modulated expression ("feel alive") is **live in
  the default avatar** (mood shifts tail cadence — `src/renderer/character/avatar.ts` /
  `src/renderer/character/petExpression.ts`; the resting *neutral* cat is visually unchanged, so it only
  differs once mood shifts), a read-only "being-known" line, the soul catalog (cat default; Miro=dog per
  `src/renderer/character/souls.ts`, **superseding the legacy `src/shared/pets.ts` cat-cosmetic entry**; dog
  art pending), the cosmetics fake-door now listing only souls with a real renderer (`cosmeticsStore.ts`, so
  Miro is not sold as a cat recolor), the release/cohort channel guard that strips deferred-v0 flags at app
  startup (`releaseChannel.ts` / `window.ts`), opt-in DECIDE/`args.task` trace capture for memory-steered proof,
  and a **dormant, gated-off** ambient track (belief-latch + eye + trigger). What stays **off by default is
  the ambient/proactive track**, not expression.
- **The engine got *further ahead* this session (the W0–W8 rebuild, #134–#149).** The orchestrator is
  now a typed Turn/Pump state machine (#146), memory swapped PGlite for an in-memory index + zero-authority
  sidecar (#147), the Agent-SDK executor added **pre-execution** destructive gating (#148, dark), and the
  core is now Electron-free behind four platform ports (#149) — plus 5→50 eval fixtures and voice extracted
  to `packages/voice`. All real, all merged. **None of it moved the bottleneck.**
- **The truth underneath:** **not one non-founder has used roro.** The core thesis ("being known"
  drives retention) is **unvalidated**, and by our own bar — joy/delight, the blend of function +
  cuteness + entertainment — **we are not there yet.**
- **Competitive event — Codex Pets (2026-07-02).** OpenAI shipped selectable desktop-pet skins on Codex.
  The frame is now commoditized (as priced: the cat is the frame, not the payload); the moat is unchanged
  and lives on the **ownership axis** (local/encrypted/correctable/vendor-portable memory — provenance even
  records `claimed_by:'codex'`). The consequence for *this doc* is sequencing (§8): the **pet-first
  contingency is near-dead** (you can't out-cute a free incumbent skin) — **job→memory is effectively the
  only bet**, and validation urgency is up.

**Read this honestly: the architecture is *further ahead* of the product than ever — and even more so
after the rebuild. The bottleneck is, and remains, signal and validation, not capability.**

---

## 2. Where we're going (the vision, compressed)

**The first AI companion that's genuinely *yours*** — local, private, embodied, that knows you, works
with you, and is present; an AI you'd grieve losing because it knows you, has never betrayed your
trust, and lives on your machine. Coding is the wedge; the moat is **restraint + relationship +
ownership** — a wedge incumbents are poorly positioned to copy (their business models pull toward the
cloud, the data, and engagement). Full articulation:
`PRODUCT_PLAN.md` (the souls/companion model of record is summarized in its banner; the full
companion-architecture doc lives in git history, `77b2241`).

---

## 3. The gap (what's actually missing — and what isn't)

| Gap | Distance | Note |
|---|---|---|
| **Validation** — zero real users; the retention thesis is untested | **nearest, biggest** | Everything downstream is a guess until this closes. |
| **Craft / delight** — the soul has a skeleton but isn't *felt* (no personality copy/narration, no authored moments) | near–medium | This is the "not there yet." Closed by authored taste, not features. |
| **Launch readiness** — notarized build + first non-founder hands | near | Mechanical *plus* human-observed trust validation (clean-second-Mac notarization **and** a non-founder watching recall survive quit/relaunch), on the critical path. |
| **Companion frontier** — ambient *plumbing* (eye/latch/trigger) is built but **dormant**; **souls** still need authored art; **durable/persisted inner-life** needs design + storage (the *transient* attention→expression wiring — `petState` already carries the fields — is Arc B, no new storage) | far | **Gated on signal, not a gap to close now.** Only the ambient plumbing is "ready"; souls + persisted inner-life are unbuilt art/design/storage work. |

What is **NOT** a gap: raw coding capability or a bigger-model strategy, or more dormant
infrastructure. (One real caveat: behavioral *fact-extraction* quality on the local 3B is a known
ceiling — ~40% in `../HANDOFF.md` — and a genuine trust-loop risk. Be precise about what the correction
loop covers: it makes a **wrong *stored* fact** correctable (see/fix/verify/forget — `PHASE2-TRUST-LOOP.md`),
but a **fact the extractor *missed* entirely** has nothing to correct — the loop explicitly **rejects**
"say *actually remember X*" as the fix. So the ceiling is **only half-absorbed**: wrong-stored is handled;
**missed-extraction is an open risk**, surfaced only by exercising natural-language **teach → store →
relaunch → recall on a clean profile** (the Arc A rehearsal, step 1). It is not a "non-gap.")

---

## 4. The fixed frame — invariants (non-negotiable)

These are the locked invariants (one authoritative merged list: `../FOUNDING.md`; engineering detail:
`../HANDOFF.md`). **Any plan step that requires breaking one is wrong by
construction** — that is how the plan stays coherent with the long-term moat.

- **Local-first / $0 / offline-default** — brain, vision, memory, and embeddings run
  on-device, and memory **never** goes to the cloud. (This section used to carry a long caveat that the
  cloud-brain escape hatch was *privacy-affecting, not memory-safe* — in that mode brain calls, including
  memory embeddings and recalled memory injected into the DECIDE prompt, left the machine. That analysis was
  real and correct, and it is **moot as of 2026-07-01**: the cloud fork was **deleted outright** (#139) and
  `BRAIN_PROVIDER` now fails loud with a typed error on anything but `'ollama'` — the invariant got
  *stronger*, not reworded.) (Separately, the
  **coding executor CLI** — Codex/Claude — is your own, signed in *outside* Roro, and may need its own local
  auth and network; Roro's *brain/memory path* requires neither — `../HANDOFF.md`, `../README.md`.)
- **Files-as-truth** durability; the index is a rebuildable cache.
- **Owner-scoped** memory, identity injected main-side.
- **Fail-loud** over silent-degrade.
- **`turnRun` is the one chokepoint** — hang things off it, never fork it.
- **Frozen `ActionEvent` / `Command` unions** — extend only deliberately, with the exhaustive updates.
- **Point-don't-act** — approval rides a disjoint IPC pair, default-DENY; no spoken word approves
  `rm -rf`.
- **Present ≠ watching** — explicit consent + a visible tell; never imply always-on monitoring.
- **Voice is mouth-not-brain** — committed transcripts route *through* `turnRun` (recall → decide →
  remember); TTS is output-only, never a speech-to-speech bypass (`../HANDOFF.md`). (Governs Arc B's
  narration work.)
- **Restraint / never-needy** — earns attention, does not demand it; no engagement dark-patterns.

---

## 5. Non-goals (what we are NOT building)

- ❌ A chatty assistant, or any engagement-maximizing / needy mechanic.
- ❌ A persistent bond integer / greeting tier — **cut** as Tamagotchi-adjacent risk (the read-only
  "being-known" line is the non-violating equivalent).
- ❌ Cloud sync/accounts/any cloud path for **memory**, period. (The old cloud-brain escape hatch — the
  privacy-affecting exception §4 used to caveat — was deleted from the codebase in #139; there is no cloud
  path left to except.)
- ❌ Telemetry or silent analytics of any kind — measurement is tester self-report + observer notes +
  opt-in **local** trace packets only (`COHORT_TRACE_TO_EVAL.md`).
- ❌ Always-on surveillance, or UI that implies it.
- ❌ Feature bloat or speculative infrastructure built *ahead of signal*.
- ❌ A second-species avatar faked in code (the dog needs authored art + visual review).

---

## 6. The three arcs

Each arc states a **hypothesis**, a **felt-outcome definition of done** (not "feature merged"), and the
steps. Only **Arc A is a commitment**; B runs in parallel **only where it directly improves Arc A's
first-turn/memory validation** — otherwise it is deferred (§7 rule 4); C is set by A's signal.

### Arc A — Ship to learn (now; the critical path)
- **Hypothesis:** recalled, owned memory ("being known") makes a developer come back.
- **Done — three product *signals* (listed in the order a *user* lives them; the *validation* order differs
  — signal (ii) is proven earliest and cheapest, pre-cohort, per step (1) and `../PUBLIC.md` Phase 0 "the
  keystone"):** (i) **first-turn trust** — a stranger's first turn lands correctly
  (or clarifies); (ii) **the memory moment, observed** — a *non-founder* watches a fact from session 1 get
  recalled *correctly* in session 2 after a **full quit + relaunch**, **and that recall *shapes the actual
  coding work*** (not merely echoed in narration — `../PUBLIC.md` "The heart" + the sharpened magic-moment
  gate, **qualitatively observed** by a non-founder in steps 1–2; the rigorous criterion-(b) packet is
  *separate hardening*, not the release bar), not `- true` garbage; (iii) **retention — a *soft* signal
  near-term, not the behavioral bar.** Near-term we have only an **assisted follow-up + self-report** (the
  non-founder returns for a — possibly founder-arranged — second session, points to a moment it knew them, and
  says they'd reopen); per "self-report ≠ behavior" (step 4) this is **soft corroboration, *not* proven
  retention**. So the **cohort-launch gate is signals (i) + (ii)** (what lets us ship to the cohort); true
  **behavioral retention (observed reopen) is `../PUBLIC.md`'s Phase 3 *broaden* gate — canonical owns it**
  (whether to broaden beyond the first cohort), needing the local launch/turn ledger (step 4). It is a
  *distinct, later* gate, **not** a ROADMAP-private "post-Arc-A" invention and **not** a near-term
  cohort-launch blocker. Signal (ii) is the actual thesis under test — being known;
  (i) and (iii) bracket it but **do not substitute for it**. **Release precondition (the install *gate*
  blocks the cohort, not optional):** signals **(i) and (ii)** — the release-blocking ones; **(iii) is soft
  cohort corroboration, *recorded but not release-blocking*** (true behavioral retention is `../PUBLIC.md`'s
  Phase 3 *broaden* gate, step 4) — are *measured on the public build* and are **not "done" until the
  distribution gate clears first**: a Developer-ID **signed + notarized** `.dmg` launching
  with zero Gatekeeper warnings on a clean *second* Mac, with a *correct* recalled fact surviving a full
  quit/relaunch on that build (`../PUBLIC.md` / `../HANDOFF.md` — "public-ready when **all** of these are
  observed"). Same-build validation + cohort vibes is **not** done while the install gate is open.
- **Prerequisites (two kinds — *blocking semantics differ; classify by consequence, not position*):**
  - **(P1) Evidence-capture instrumentation — *landed, non-blocking for shipping*** (gates **only** the
    rigorous memory-steered *proof* milestone; the minimal preflight, recall, install gate, and cohort all
    proceed without it). `RORO_TRACE=1` plus opt-in `RORO_TRACE_DECIDE=plaintext` can capture the DECIDE
    prompt and generated `decision.args.task`; `npm run verify:memory-steered` proves the synthetic marker
    reaches both DECIDE and `args.task` in the deterministic proof path. This does **not** change the release
    bar: the signed-build human observation is still the gate, and the mechanized counterfactual packet is
    hardening/post-v0 proof work.
  - **(P2) Cohort/release-mode startup guard — *landed, keep green before cohort*** (cohort cleanliness +
    safety). A baked release-channel constant strips every deferred-v0 flag at app startup — cosmetics, voice,
    the privileged `RORO_DEBUG_BRIDGE`, smoke harnesses, and memory-health smoke failure (canonical list:
    `src/shared/deferredEnvKeys.ts`; the legacy avatar-model flag left the list when that path was deleted, #140) — and
    `npm run verify:release-channel` proves launch-time env cannot re-enable them on a release build.
    Separate note: `RORO_DEBUG_PORT` is a local CDP smoke hook, not a deferred-v0 product feature; keep it
    unset for cohort/release launches until it is made smoke-channel-only in code.
- **Steps — a checklist (satisfying one item is *not* satisfying the next; "done" requires all):**
  1. **Preflight rehearsal** — *same-build, no certificate; de-risks cheaply but does **not** pass Arc A.*
     On a **clean profile**, a non-founder states a preference in **natural language**, then across a full
     quit/relaunch on the *same build* confirms **both**:
     - **(a) recall is correct** — the fact is *extracted, stored, and recalled correctly* (exercises
       extraction → store → recall, not just durability — surfaces the missed-extraction risk in §3).
     - **(b) memory steers a real coding turn** — an actual `run_agent` run. **Two tiers — do *not* gate
       shipping on the lab protocol:** the **minimal preflight (ship-to-learn)** is just — a non-founder
       teaches the fact, runs a coding task **whose prompt *omits* the marker/fact** (else the diff echoes the
       *prompt*, not memory — record the exact prompt to show it), and you **observe the output/diff reflect
       it**; that is enough to proceed to the **signed install gate / cohort prep** (step 2 — *not* straight to
       cohort, which the install gate still blocks). Everything below — the two-clone counterfactual, N attempts, capture packet — is the
       rigorous **memory-steered *proof* milestone**: it hardens the claim and seeds the automated smoke, but
       is **not a blocker for the first cohort** (it is what prerequisite P1 gates). Its pass is an **artifact,
       not vibes**: the event stream shows **memory status beat → `run.started` → `run.completed { ok: true }`**
       (and **no** `run.failed` — `src/shared/events.ts`; a failed attempt is **not** "memory shaped work"),
       **and** the diff reflects the remembered preference. The status beat alone is **only a count**
       (`formatMemoryStatus`), and "absent from the prompt" is **not enough** — a repo default ("TDD always"
       — `../HANDOFF.md`) confounds it. So the preference must be a **pre-registered *synthetic* marker** — an
       arbitrary token chosen up front that no repo norm would produce (a naming quirk, **not** "writes tests")
       and **deliberately not real personal data**, so the proof artifact is privacy-safe (packet rules below)
       — **and counterfactually controlled** via a **two-clone +
       two-memory-root protocol:** two fresh clones of the *same* baseline commit **and two isolated memory
       roots** (`RORO_DB_DIR`/`userData` — memory lives *there*, **not in the repo clone**, so isolating only
       the repo leaves the control contaminated by the taught global profile — `../HANDOFF.md`), with
       **identical prompt + executor/model settings**, the only difference being memory present vs absent —
       **both roots share identical `owner.json` (same owner identity) + settings, but each `config.json`'s
       absolute `workdir` points at its *own* clone** (`config.json` stores the workdir —
       `src/main/configStore.ts` — so identical configs would aim both arms at the *same* repo and ruin the
       diff); **only the memory *content* then differs** (the control's store is empty; `src/main.ts` derives
       `RORO_DB_DIR` from `userData` when unset, so seed it explicitly). The
       control's memory root must be **verified memory-empty** — robustly, by capturing the control's **DECIDE
       input** and confirming it has **no `KNOWN ABOUT THIS USER:` (facts) and no `RELATED PAST CONTEXT:`
       (episodic recall) section** (`src/main/memoryContext.ts` builds DECIDE memory from *both* channels, so a
       fact-empty root with relevant episodes still contaminates the control); behavior **present with memory,
       absent without**. Narration merely *echoing* the fact
       is **not** a pass. Today this is a **manual disposable-repo check**; a **memory-steered packaged
       executor smoke** is the **tracked gap** — *not* satisfiable by the existing smokes
       (`verify:packaged-natural-memory-turn` asserts no executor starts — `scripts/smoke-packaged-memory.mjs`;
       `verify:packaged-first-task` doesn't teach/recall). Because the executor is **stochastic** (a single
       output diff can false-pass/fail even at identical settings), that smoke should assert
       **deterministically on prompt-capture — at the *correct hop*:** memory flows **memory → the DECIDE
       prompt** (`buildDecisionPrompt`, `brain/index.ts`) **→ the generated `decision.args.task` → the
       executor** (`orchestrator.ts`); the executor never sees memory verbatim. So capture **(1) the recalled
       preference in the DECIDE input** *and* **(2) the preference reflected in the generated `args.task`** —
       *not* "the executor's prompt" (that tests the wrong hop). (**Capture path — opt-in/local only:** product
       `turnRun` still exposes only events/runEnd (`src/preload.ts`), `buildDecisionPrompt` remains private
       (`src/brain/index.ts`), and the debug `brain.decide` bridge **bypasses** orchestrator recall
       (`src/main/ipc.ts`). Use the landed trace capture (`RORO_TRACE=1` +
       `RORO_TRACE_DECIDE=plaintext`) for local proof packets; raw prompt/task traces stay local and are
       redacted before any committed artifact.)
       Even then, prompt-capture is **necessary, not
       sufficient** — it proves memory *shaped the task*, not that the executor *honored* it; so keep the
       **diff-reflects-preference output check** as the real-honoring proof (judged across runs, given
       stochasticity), and keep **real Codex/Claude as a separate auth/readiness check**. **The manual check
       is auditable — it produces an evidence packet:** {build id; both memory-root paths + the empty-control
       proof; the exact prompt; the event stream; the generated `args.task`; the resulting diff; observer +
       date}. **Packet format (privacy-safe):** the **raw** packet (full DECIDE prompt — recalled
       facts/episodes, `src/main/memoryContext.ts`) stays **local-only, outside the repo, consented, deleted
       after review, never committed** (unlike traces, which `COHORT_TRACE_TO_EVAL.md` keeps free of memory
       text, it necessarily contains memory); the **shareable** form carries only the **synthetic marker +
       whether it reached `args.task`/the diff** — redaction-safe *because* the marker is synthetic, yet still
       proof. **Durable audit artifact (the raw packet is deleted, but the *trail* persists):** a redacted
       record — content **hashes** (prompt/task/diff), the synthetic marker, per-attempt pass/fail, observer +
       date, and a **deletion confirmation** for the raw packet — committable because it carries no memory
       text. **Repeat/pass protocol (executor is stochastic):** run **N=5 attempts per arm, pre-registered** (treatment =
       memory present, control = empty); **pass = the marker reaches `args.task` *and* the diff in ≥3/5
       treatment runs and 0/5 control** (fixed threshold, **no post-hoc choosing**); log + classify **every**
       attempt as **extractor** (marker absent from the DECIDE input), **DECIDE** (in the DECIDE input but not
       `args.task`), or **executor** (in `args.task` but not the diff). **This packet is the *mechanized* proof (post-v0 hardening), *not* the release gate** — the
       release gate is the **qualitative signed-build observation** that a non-founder sees a recalled fact
       **shape the actual coding work** (`../PUBLIC.md`, now sharpened *there* to match this thesis so
       **ROADMAP and canonical agree**; not a stricter-than-canonical bar). Arc A cannot "pass" on narration
       recall alone, but the *mechanized* packet is hardening, not the bar.
       **Decision (not a floating gap):** the waiver is **narrow** — it swaps
       **manual for automated, never the build**: the
       memory-steered check runs **cheaply on the same-build preflight** (non-founder, no cert — cheapest-first
       is about the *build*, not the actor; PUBLIC's Phase 0 magic moment is non-founder even on the same
       build) **and is re-confirmed by a non-founder on the signed build** (step 2 — signals (i)–(iii) are measured on the
       public build). What v0 waives is only the *automated* smoke; that **memory-steered packaged executor
       smoke is a named post-v0 deliverable**, not a vague backlog item.
  2. **Signed install gate** — *the word "gate" is reserved for this.* A signed/notarized Developer-ID `.dmg`
     launching with **zero Gatekeeper warnings on a clean *second* Mac**, with a *correct* recalled fact
     surviving a full quit/relaunch on that build (`../PUBLIC.md` / `../HANDOFF.md` — "public-ready when
     **all** of these are observed"). **This signed build is the *required build* for every later Arc A signal
     packet**; same-build rehearsal + cohort vibes do **not** pass Arc A while the install gate is open. **Step
     2 has two distinct parts. (2a) the signed *artifact* gate:** clean install + signed-build recall survival
     (Gatekeeper-clean — an *artifact* check; the only true "gate"). **(2b) signed-build *signal* packets**
     (observed on that build, *not* the artifact gate — one founder-supervised install session is **not**
     cohort evidence): the **first-turn validation packet (signal i)** {the prompt; did it *land* or
     *clarify*; was any recall correct; observer + date}, **and the *minimal qualitative* memory-steers-coding
     observation (signal ii)** — a non-founder runs a coding task **whose prompt omits the marker/fact**
     (anti-echo control; record the exact prompt + the synthetic marker) and a human sees the output/diff
     reflect the fact. This is `../PUBLIC.md`'s magic-moment gate as **qualitative evidence — suggestive, not
     causal proof** (a diff showing the marker does not *prove* memory caused `args.task` without capture +
     counterfactual — criterion (b)). The rigorous, P1-gated counterfactual **packet is the separate proof
     milestone** (not required to pass step 2). So Arc A cannot "pass" on recall/narration alone, yet it also
     does **not** claim mechanized rigor it can't yet produce.
     Signal (i)/(ii) are not "done" on assertion, only on these recorded outcomes. (Retention — signal iii — is measured later, in cohort/step 4,
     *on this build*.)
  3. **Cohort** — a *tiny* circle of non-founder users (private, forgiving). **Protocol (compact):** record per
     tester — type (friend / dev-community), **co-located vs remote** (sets behavioral-vs-self-report, step 4),
     consent + trace rules (`COHORT_TRACE_TO_EVAL.md`), a **standard first task**, observer fields
     {landed | *clarified* | failed; recall correct?}, and failure category (onboarding / executor / recall /
     extraction). "Lands or clarifies" = the turn either does the task or asks a *pertinent* clarifying question
     (not a generic refusal).
  4. **Retention / measurement (no telemetry)** — "actual" needs a defined, consented source of truth, or it
     collapses back into the intent it is meant to beat. **Today that source is the observed/co-present
     session** — the founder witnesses the reopen directly (the narrow cohort is chosen precisely so every
     reopen can be watched). A **local-only launch/turn ledger the tester voluntarily exports** would also
     qualify (consented self-export, never auto-sent), **but it does not exist yet**: today's `RORO_TRACE`
     records recall/eval diagnostics, **not** launch/turn/reopen behavior (`src/memory2/tracer.ts`,
     `COHORT_TRACE_TO_EVAL.md`), so it is a **tracked prerequisite, not a current capability** — the
     **prerequisite for `../PUBLIC.md`'s Phase 3 *broaden* gate:** a local-only, consented, tester-exportable
     log of launch/turn/reopen events;
     **acceptance check:** it records reopen timestamps with **no telemetry**, and a non-co-located tester's
     *unprompted* reopen becomes verifiable from it. **Until it ships, Arc A behavioral retention stays
     co-located-only.** Treat **three
     distinct signals, never collapsed:** (1) **immediate soft intent** — the "would you want to reopen?"
     self-report (soft, asked of *everyone*); (2) **observed retention** — a co-present session only proves an
     **assisted follow-up** (the session happened; the magic moment can be witnessed) — it is **not** an
     *unprompted* return unless the founder genuinely sees an **unbidden** reopen in a co-located setting. The
     thesis is **unprompted** return, and that — for both the second-day and the week-2 reopen — is
     **behavioral only when witnessed unbidden or logged by the (not-yet-built) local ledger**; otherwise it
     is **self-report, not behavior** (build the ledger to promote it). **Cohort caveat:** `../PUBLIC.md`'s
     cohort is "friends + one AI/dev community"; **to the extent any tester is remote / non-co-located**, they
     **cannot** be co-present-observed — for them, absent the ledger, reopen is **self-report only**, so
     behavioral-retention claims are limited to the **co-located subset** until the ledger ships; (3)
     **attachment** — the
     grieve-test ("would you be annoyed to lose it?"), asked **of churned testers too**, not only survivors
     (else the *why-they-left* signal is lost). Never substitute intent ("will you reopen?") for behavior.
     (`../PUBLIC.md` already treats its cohort question (3) as a *soft self-report*, never the retention
     metric — the metric is the *observed* reopen, which PUBLIC's Exit uses.) Attachment signals are explicit
     tester **self-report + observer notes**, under the **same data-handling discipline as traces: local-only,
     consented, redacted before they seed any fixture, never committed raw** (`COHORT_TRACE_TO_EVAL.md`).
     `RORO_TRACE` is **not** an attachment metric — default mode carries no transcripts/facts and only seeds
     eval fixtures (diagnose DECIDE/EXTRACT/recall *failure mechanisms*); `RORO_TRACE_QUERY=plaintext` is
     **forbidden for cohort runs** unless a tester opts in and the file stays local. Never silent analytics.
  5. **Founder dogfoods daily** (irreplaceable insight).
  6. **Before the first *update* ships — a tracked longevity check, separate from the Arc A release** (there is
     no build N+1 at first release, so this is *not* a first-release precondition): a **two-build update
     durability** check — install build N, store a fact, install build N+1 under the *same bundle/team
     identity*, relaunch, recall (the Developer-ID cert's **second** role: stable-team-identity keychain
     durability; an ad-hoc `cdhash` orphans the prior corpus). **Promote to a formal gate in
     `../PUBLIC.md`/`../HANDOFF.md` at that milestone.**

### Arc B — Close the delight gap (parallel; taste-led)
- **Hypothesis:** an authored personality + a few true "felt-alive" moments turn "useful tool" into
  "I'd grieve losing it."
- **Done =** the copy/narration work **measurably improves Arc A's signal (i) first-turn trust or (ii) the
  memory moment** — judged by those signals, not by taste — **which can only be shown *post-cohort*** (the
  signal-(i)/(ii) evidence before/after on a clean profile, with **no provenance drift**). **Pre-cohort there
  is only a *safety gate*, not "done":** **DECIDE/EXTRACT no-regression + a clean manual provenance check**
  (safe-to-ship — *don't break the trust path*); that proves no harm, **not** improvement. **Post-signal
  (aspirational):** an alpha user smiles, shows a friend, or talks back to her, and the founder genuinely
  grins at her daily. **Negative criteria (job-first; `../HANDOFF.md`):** every delight moment must be
  *earned by real function* — it must never delay the coding turn, demand attention, or worsen the
  first-turn-trust signal (i). A delight that hurts the job fails this arc.
- **Steps — split by what serves Arc A *now* vs what waits for signal:**
  - **Pre-cohort (only because it serves Arc A):** the personality **copy** / narration style (tone and
    word-choice — **not** the voice STT/VAD/TTS stack, which is cut from v0), **scoped to what improves the
    first-turn trust (i) or memory moment (ii)** — **with a hard safety boundary:** `decision.narration` is
    produced by DECIDE, is the **canonical main-side text used for fact-extraction and attempted persistence**
    (`rememberNarration` is best-effort / fire-and-forget — `orchestrator.ts`), and feeds the trust path. So renderer-side copy may only add **non-semantic** expression (timing, typography,
    animation) that does not change the words' meaning; any **semantic** narration rewrite must happen
    **main/DECIDE-side and clear DECIDE/EXTRACT evals + packaged natural-memory verification** — otherwise the
    text the user sees drifts from what memory, traces, and source inspection recorded (**provenance drift**).
    The existing smokes split the coverage — natural-memory asserts *no* executor starts, the first-task smoke
    runs `run_agent` but doesn't teach/recall, and the **memory-steered/provenance smoke does not exist in
    `package.json` yet**. **Precondition (explicit):** until that smoke is built, semantic coding-turn
    narration changes are **manual-gated** (a manual `run_agent` narration/provenance check); building the
    dedicated smoke is the Arc B precondition that automates this. **Copy surfaces (the design contract —
    which text exists, and its class):** `answer` / `clarify` narration, the `run_agent` pre-dispatch line,
    blocked/destructive refusals, the memory-status beat, and done/error — each is either **DECIDE-semantic**
    (produced main-side, flows to extraction/persistence → needs DECIDE/EXTRACT evals) or **renderer-only
    expression** (cosmetic, off the trust path). **Scope:** Arc B owns **personality/narration copy only**;
    the **functional trust-UI copy** — onboarding/model-setup, executor-readiness, the Memory-panel
    correction/source strings, and actionable failure UI (`../PUBLIC.md`) — is **Arc A / Phase 2, not Arc B**.
    Classify every copy change before making it. **Starter matrix** (surface · owner · allowed change · file ·
    verification) — extend in the Arc B design deliverable: `answer`/`clarify` narration → DECIDE/main ·
    *semantic* · `orchestrator.ts`+brain · DECIDE/EXTRACT evals + provenance; `run_agent` pre-dispatch line →
    DECIDE/main · *semantic* · `orchestrator.ts` · provenance (persisted+extracted); blocked/destructive
    refusal → main · *wording only* · `orchestrator.ts` · safety-spine tests unchanged; memory-status beat →
    main · *wording only* · `src/shared/events.ts` (`formatMemoryStatus`) · `parseMemoryStatus` round-trips; done/error →
    renderer · *non-semantic* · renderer · visual only, off the trust path.
  - **Post-signal (deferred until Arc A signal picks it — §6, §7 rule 4):** richer mood/attention →
    expression (a *transient projection* off existing pet-state — `petState`/`petExpression` — **not** new
    durable inner-life state, which is Arc C, gated on signal and storage design); a small number of *earned*
    ritual moments — all **sparingly** (restraint is the design value; the charm must be the *true* expression
    of real function, never decoration). Craft cycles are first-class, not polish-at-the-end.

### Arc C — Expand on signal (far; gated)
- **Hypothesis:** *deliberately unset* — Arc A's signal picks which organ (ambient eye / a second soul
  / deeper being-known) is the next investment.
- **Done =** the chosen organ clears the **same grieve bar** as the core.
- **Steps:** build the signal-picked organ as a **pure, gated, behavior-preserving module** off an
  existing chokepoint (the pattern proved by the companion foundation). The brain/vision **provider seam
  is cleaned up only *if* the chosen organ needs it** — not first, and not by default. (The old cloud
  brain path was deleted outright in #139; any future cloud provider would be a deliberate new build
  gated on the invariants in §4, never a default story.)

---

## 7. How we plan + execute carefully (the method)

1. **Plan around hypotheses, not features.** Each phase names a hypothesis and a falsifiable signal;
   the first job is to *test* the riskiest one cheaply, not build more.
2. **Separate the finishable from the discoverable.** The core is a *known spec* → finish it, ship it,
   plan it heavy. The frontier is an *unknown spec* → rapid iteration on real signal. Don't cross the
   rigor levels.
3. **Invariants are the frame (§4)** — plan inside them; reject by construction anything that breaks one.
4. **Sequence by what unblocks learning, not by what's exciting.** Critical path: **same-build human
   rehearsal → signed/notarized clean-Mac build → cohort users → signal → informed next bet.**
   Everything off it is deferred, including the eye and the dog.
5. **Thin, reversible slices, each with a verification check** (pure module → test → review → ship,
   behavior-preserving). For *irreversible* moves — notarization identity, data schema, the public
   first impression — slow down and verify hard.
6. **Definition of done = a felt outcome**, never "feature X merged." The grieve-test is the
   north-star metric.
7. **Re-plan on signal, not on schedule** (§8).

**The #1 risk is the prototyper pull** — building the next exciting thing before the current one is
validated. This plan exists partly to impose *ship-and-learn before expand* on ourselves.

---

## 8. The re-plan checkpoint

After the first cohort, **re-plan Arcs B and C against what users actually love** — do not pre-commit
the far roadmap. Keep the vision (§2) as the compass and the grieve-test as the metric. **Post-Codex-Pets
(§1), the pet-first contingency starts from near-dead** — a second-soul / pet-pivot re-plan competes with a
free incumbent skin and should clear a *high* bar; the wedge to re-plan *toward* is a deeper job→memory
loop, not a cuter pet. **The lightweight
decision rule (so the next bet is signal-driven, not vibes-driven):** for an **already-built** behavior,
keep it only if a *majority* **of the co-located behavioral subset** (the group whose reopen is *observed*,
not self-reported — Arc A step 4; remote testers' self-report **corroborates but never substitutes**) would
genuinely grieve losing it — **with a minimum sample: below a handful (~n < 5) the read is *directional
only*, not decisive** (gather more, or build the ledger; never let one or two testers set the roadmap) — shown by an *unprompted* reaction **and** a *specific* moment they can name (per
Arc A step 4's discipline: behavior or witnessed signal, not stated intent alone). For an **unbuilt organ** (a second soul, the ambient eye — you can't grieve what doesn't
exist yet), instead **pick the next bet from the named *loved moments* in Arc A**, then set that organ a
**separate experiment bar** it must clear once built (its Arc C "Done = clears the same grieve bar"). If
nothing clears either bar, **re-plan the wedge** rather than expand. Update this doc; it is meant to change.
