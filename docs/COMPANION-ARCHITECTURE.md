# Companion Architecture & Merge Roadmap

> **Status — forward-looking vision, NOT the v0 launch plan** (same tier as `PRODUCT_PLAN.md`).
> Canonical remains `HANDOFF.md` + `PUBLIC.md`; the **"Path to Public"** launch sequence in `PUBLIC.md`
> takes priority over everything here. This doc folds the proven pieces of the *Miro* prototype (a
> 24-hour always-on screen-watching desktop pet) into roro and sets the **post-launch companion
> roadmap**. It hangs new organs off the existing `turnRun` chokepoint — it **forks nothing** and
> breaks **no** locked invariant. Where it changes a prior written commitment, it says so in §0.

---

## 0. What this supersedes (in-band, per repo convention)

This doc changes exactly three prior commitments. Nothing here overrides a **LOCKED INVARIANT**
(`HANDOFF.md`) or the `PUBLIC.md` launch sequence.

| Prior commitment | Change | Rationale |
|---|---|---|
| `PUBLIC.md` — *"Keep this identity; don't design a new brand."* | **roro becomes the species/brand**; individual names become **selectable souls**. | The `-ro` roster already exists in `src/shared/pets.ts` (roro/miro/sero/taro). This *formalizes a roster that was always there* — it does not invent a new brand. roro stays the face. |
| `pets.ts` — roster entries are **palette swaps of one procedural cat** ("named after the founder's real pets"). | Souls may be **distinct species + personalities**, not just palettes. **Miro is reframed as a dog** (the prototype character). | A roster of identical cats is a cosmetic; a roster of distinct *temperaments* (aloof cat / eager dog) is the personalization + attachment mechanic that serves the "joy & delight" bar. |
| `PUBLIC.md`/`HANDOFF.md` — **ambient/clipboard proactivity cut from v0 as "wrong order."** | The ambient eye is **built but gated**, sequenced as a **post-trust, consent-first phase** (§6). | The cut was about *order and consent*, not a permanent ban. We honor the order: trust first, eye later, always through `turnRun` with a visible tell. |

**⚠ Naming flag — "Nero":** the black cat's proposed name collides with roro's **deprecated project
codename** (it survives only in `docs/superpowers/*nero*` and `docs/design/nero-*`). `isRoName('nero')`
passes, so nothing blocks it, but reviewers will read "Nero" as the old codename. **Open decision (§9).**

---

## 1. North star & the one problem

We extend — not replace — the canonical north star (`PUBLIC.md`: *"being known — the relief of not
re-explaining yourself"*) and the thesis (*job → habit → memory → moat*).

**The one problem:** developers have powerful AI help, and **none of it is theirs** — it's cloud-bound,
account-gated, stateless per session, and your code leaves your machine. roro owns the gap: **an AI that
knows you, works with you, and never leaves your machine.** Coding is the wedge; the long arc is *the
first AI that's actually yours.* "Best product" here = **a companion a user would grieve losing** —
measured by relationship depth over time, not feature count.

---

## 2. Product model — one engine, many souls

- **roro** = the species **and** the product. A "roro" is the kind of creature; the app is roro.
- **Souls** = individual roros you adopt and can switch between — a cat, a dog (Miro), more later — each
  a `{look, voice/personality, expression-map, temperament}` pack. roro remains the flagship/face.
- **One engine, many souls:** the engine is **character-agnostic** and emits *semantic events*; the
  selected soul decides only how those events are *expressed*. Same failing test → an aloof tail-flick
  or an eager trot. Function identical; charm is the soul.

This separates the two meanings of "Miro": **Miro the soul** (a selectable dog) vs **the ambient-eye
capability** (which graduates into the engine, available to *every* soul).

---

## 3. The v1 baseline engine — seven organs

Every soul is born with these. Each folds the best of current-roro + the Miro prototype, lands at a real
path, and respects the named invariant.

| # | Organ | Folds from | Lands at | Invariant honored |
|---|---|---|---|---|
| 1 | **Senses** | roro `capture_screen` (deliberate) + Miro change-gate / self-mask / 3-frame (ambient) | `src/vision/` (+ a gated ambient source, §6) | local vision model; **present ≠ watching** (visible tell, consent) |
| 2 | **Restraint** | Miro belief-latch (edge-trigger) + verifier + safety-priority | a gate **before** `turnRun` | *earns attention, does not demand it*; quiet 99% |
| 3 | **Being-known** | roro `memory2` (the moat, untouched) + Miro session/recurrence/recap/carry-forward | `src/memory2/` (+ a thin episodic tier) | files-as-truth, owner-scoped, **memory never leaves the machine** |
| 4 | **Hands** | roro executor + safety spine (unchanged) | `src/executor/`, `src/main/confirmGate.ts` | **point-don't-act**; approval on the disjoint confirm IPC, default-DENY |
| 5 | **Body** | roro `CharacterDriver` + state machine + Miro intent-machine / receipts / drowsiness | `src/renderer/character/` | frozen `AvatarState` (6) — mood is **orthogonal**, never a new state |
| 6 | **Resilience** | Miro self-heal (timeout/watchdog) + roro preflight/doctors | local model call sites | fail-loud over silent-degrade |
| 7 | **Inner life** | Miro Bond + roro's PRODUCT_PLAN `PetMood`/`Energy`/`Attention` | new `src/inner/` (a projection) | §4 below |

---

## 4. Inner life (the Tamagotchi layer) — a pose-modulating projection, never needy

This is **already roro's own Phase-1 vision** (`PRODUCT_PLAN.md`: `PetMood` sleepy/curious/playful/
focused/proud/worried, `Energy`, `Attention`, and *"a pet-state model **separate from** `AvatarState`"*).
We implement it as a **projection over memory + the event stream**, not a new pipeline:

- **Slow state** (bond, growth stage, milestones, days-together) — persisted as an **owned, encrypted,
  rebuildable** file (files-as-truth), MAIN-side. Updated in `REMEMBER`.
- **Fast state** (mood/energy) — an in-session reducer over the event stream. Feeds the avatar and
  **modulates pose orthogonally**; it does **not** add `AvatarState` variants.
- **The care loop = the real work.** Working together "feeds" her; teaching her (the correction loop)
  "raises" her; the relationship deepening *is* her growing up. No fake chores.

**The hard line (Non-Goals):** **no** needs, decay, death, guilt, streak-anxiety, or nagging. Attachment
through *being known and growing together*, **never** through manufactured dependency. This is enforced
by roro's existing anti-goals (*"never needy"*, *"earns attention; does not demand it"*, *"no engagement
dark-patterns"*). Neglect doesn't punish — the relationship simply doesn't deepen.

---

## 5. Integration architecture (how it hangs off the existing spine)

Every addition respects the **LOCKED INVARIANTS** (`HANDOFF.md`):

- **`turnRun` is the single chokepoint — we hang things off it, we never fork it.** The ambient eye is a
  **new trigger source** that *feeds* `turnRun` (RECALL → DECIDE → EXECUTE/NARRATE → REMEMBER), biased
  toward narrate/point/quiet. The existing `dispatchLock` + `cancelTask`/`cancelAllRuns` give priority
  (a user turn preempts an ambient turn).
- **Frozen `ActionEvent` (11) + `Command` (4) unions.** A proactive turn **reuses** `answer` /
  `capture_screen` — restraint is decided by the belief-latch *before* the turn, not by a new command.
  Any contract extension (e.g. a `situation`/`mode` field on `DecideInput`) is deliberate, updates
  `eventToAvatarState` (`src/shared/avatar.ts`) and the hand-maintained `Command` copies, and is called
  out in its PR. **No new event/command kinds without governance.**
- **Local-first.** The ambient eye runs on the **local** vision model. Cloud (`BRAIN_PROVIDER`) stays an
  opt-in **brain/executor** provider, off by default — **never memory** (*"never pool/cloud it"*).
- **Files-as-truth + owner-scoped + fail-loud.** Inner-life state is an owned encrypted file, MAIN-side,
  rebuildable from the log; identity is injected MAIN-side; storage failures throw, never degrade silent.
- **Point-don't-act + present ≠ watching.** The ambient layer only *points*; execution still rides the
  disjoint confirm IPC with default-DENY. The eye is **consent-gated with a visible tell** (the
  `capture_screen` "Taking one screen snapshot." pattern is the compliance template) — it must **never
  imply always-on monitoring**.
- **Process boundary.** Perception + restraint + memory + inner-life live in **main**; the soul's
  expression lives in the **renderer**; they speak over the existing guarded push channels + IPC.

---

## 6. Sequencing — launch first, eye later (honoring `PUBLIC.md`)

roro's canonical priority is the **Path to Public** (prove the magic moment → onboarding → trust loop →
cohort debut). The ambient eye was cut from v0 as *"wrong order."* This roadmap honors that by **leading
with the launch-aligned, consent-free organs** (which are already in roro's own "make Roro feel alive"
plan) and **gating the ambient eye** behind trust:

1. **Aligned-now** (strengthen the launch, zero consent stakes): inner-life/mood engine → character/soul
   system → bond projection → a second soul (Miro the dog).
2. **Gated-later** (post-trust, consent-first): the ambient-turn seam (plumbing) → the ambient eye
   (off by default, visible tell) → the belief-latch that keeps it quiet.

The eye is **built but dark** until trust is established and the user opts in.

---

## 7. Non-goals (what we are NOT building)

- ❌ Needy/decay/guilt/streak/nagging mechanics of any kind.
- ❌ Cloud sync, accounts, or any cloud path **for memory**.
- ❌ Always-on surveillance, or any UI that **implies** always-on monitoring.
- ❌ Forking `turnRun`, or a parallel proactive loop that bypasses RECALL→DECIDE→REMEMBER.
- ❌ New `AvatarState`/`ActionEvent`/`Command` kinds without explicit governance + the exhaustive updates.
- ❌ Breaking any LOCKED INVARIANT to make a soul feel snappier.

---

## 8. PR roadmap (keystone = the aligned engine, not the eye)

| PR | Step | Tier |
|---|---|---|
| 1 | This doc | — |
| 2 | **Pet-state / mood engine** — `PetMood`/`Energy`/`Attention` separate from `AvatarState`, modulating pose | aligned-now |
| 3 | **Character/soul system** — `CharacterPack` + registry (extend `pets.ts`) + persisted selection; formalize the cat | aligned-now |
| 4 | **Inner-life / bond projection** — recurrence, growth, milestones, greeting/recap rituals over `memory2` | aligned-now |
| 5 | **Miro the dog** — a second soul (new avatar renderer + doglike temperament) behind `CharacterDriver` | aligned-now |
| 6 | **Ambient-turn trigger seam** — plumbing: a Situation feeds `turnRun`; gated/dark | gated-later |
| 7 | **Ambient eye** — local, change-gated, self-masked, consent-first, visible tell | gated-later |
| 8 | **Restraint / belief-latch** — edge-trigger gate that keeps the eye quiet | gated-later |

Each PR: tests (roro's near-total coverage bar), `codex review --base main` at max effort, then a PR.

---

## 9. Open decisions

- **Black-cat name** — "Nero" collides with the dead codename (§0). Options: keep Nero (note the
  rename in `pets.ts`), or pick a fresh `-ro` name. *Owner decision.*
- **Distinct-species avatars** — a dog needs a new avatar renderer; today the roster is one ~650-line
  procedural-cat builder. Scope: PR5 introduces a second renderer behind the existing facade.
- **Soul-scoped vs shared memory** — do souls share one "being-known" memory (recommended: one *you*,
  many faces) or get per-soul memory? Default assumption: **shared** (the moat is *you*, not the avatar).
</content>
