# FOUNDING — read this first

> The one document a fresh session reads before touching roro: what it IS, the invariants that must
> never break, the strategy of record, and where the depth lives. Depth is linked, not duplicated:
> [`HANDOFF.md`](HANDOFF.md) (engineering truth) · [`PUBLIC.md`](PUBLIC.md) (launch plan) ·
> [`docs/ROADMAP.md`](docs/ROADMAP.md) (execution sequencing) · [`LESSONS.md`](LESSONS.md)
> (the falsified-assumptions ledger).

## What roro is

**Roro is a local-first, on-device AI desktop coding companion** — a procedural pixel cat that floats
on your screen, runs a **local** Ollama brain, keeps an **encrypted, files-as-truth memory**, and
dispatches a real coding **executor** (Codex/Claude CLI) in the repo you choose. $0, no app-owned
cloud/model keys, offline-default, fail-loud. The magic moment is **recalled memory**: after a
restart, offline, the cat weaves what it remembers about how you work into its response — the
private, local coding companion that remembers how *you* work. The single feeling to engineer for is
**"being known"** — the quiet relief of not re-explaining yourself. The strategy is **job-first**:
lead with the coding job (it justifies the install and builds the daily habit); let *being known* be
the emergent reward. **job → habit → memory → moat.** The moat is the per-user **encrypted on-device
memory** deepened by a **human-in-the-loop correction loop** — a per-user switching cost (never
pooled, never cloud), model-independent and un-clonable. The procedural pixel cat is not a fallback
or a placeholder for a "real" avatar: it **is** the v0 identity. The coding quality is NOT bound to
the local 3B brain — the *executor* does the coding; the local brain only decides/extracts/narrates.

## Strategy of record: job-first now, pet-first only on signal

Two theses live in this repo's history: **pet-first** ([`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md)'s
"best desktop AI pet" vision tier — attachment first, utility as tricks) and **job-first**
([`PUBLIC.md`](PUBLIC.md)'s launch canon — the coding job earns the install). The resolution of
record is **JOB-FIRST for v0**: the coding job earns the daily open, memory is the payload, and the
companion feeling is *emergent* from memory and continuity — not engineered ahead of the job.
Pet-first is not dead; it is the **contingent next bet**, taken only if real cohort signal kills the
job thesis — per [`docs/ROADMAP.md`](docs/ROADMAP.md) §8's re-plan rule (if nothing clears the
grieve-test bar, *re-plan the wedge* rather than expand). Until that signal exists, any work that
serves the pet fantasy at the expense of the first coding turn is out of order.

## 🔒 Locked invariants (breaking one is an architecture regression)

The one authoritative list (merged from HANDOFF §2 + ROADMAP §4; any plan step that requires
breaking one is wrong by construction):

1. **turnRun chokepoint** — one RECALL → DECIDE → EXECUTE/NARRATE → REMEMBER path in
   `src/main/orchestrator.ts`. Hang things off it; never fork it.
2. **Frozen `ActionEvent` / `Command` unions** (`src/shared/events.ts`, `src/shared/brain.ts`) —
   consumed exhaustively; extend only deliberately, with the exhaustive updates.
3. **Voice is mouth-not-brain** — a say-only `VoiceBackend` seam; committed transcripts route
   *through* `turnRun`, never a speech-to-speech model that bypasses recall→decide→remember.
4. **Local-first / $0 / no app-owned cloud/model keys / offline-default** — no app-owned cloud
   accounts, telemetry, or required network for the default brain/vision/memory/embeddings path;
   memory **never** goes to the cloud. Executor CLIs are the user's own and may need their own local
   auth. *The old escape-hatch caveat is obsolete:* the cloud-brain fork was **deleted outright**
   (2026-07-01, #139) — `BRAIN_PROVIDER` now fails loud with a typed error on anything but
   `'ollama'`, which **strengthens** this invariant: there is no undocumented cloud path left to
   caveat.
5. **Fail-loud over silent-degrade** — `keyManager` throws if the keychain is unavailable; **never**
   stores plaintext. No `catch { return null }`.
6. **Owner-scoped memory** — every read/write scoped to `ownerId`, identity injected MAIN-side.
7. **Files-as-truth durability** — encrypted files on disk are truth; the PGlite-HNSW index is a
   derived, rebuildable cache (proven by `crosslaunch.durability.test.ts`).
8. **Recency guarantee** — memory2 front-loads the top-2 newest episodes (typed via
   `MemoryMatch.guaranteed`; recency rows carry cosine 0 → recall uses `minSimilarity: 0`).
9. **Point-don't-act** — approval rides a disjoint IPC pair, default-DENY; no spoken or typed word
   approves `rm -rf`.
10. **Present ≠ watching** — explicit consent + a visible tell (the "Taking one screen snapshot."
    beat); never imply always-on monitoring.
11. **Restraint / never-needy** — earns attention, does not demand it; no engagement dark-patterns.

## The interaction contract (summary — [`docs/INTERACTION.md`](docs/INTERACTION.md) is authoritative)

Text is the default input; the transparent floating window is the default surface; the cat's body
carries presence and affection only (tap/hold to pet, drag to move) — tasking lives in the Ask
surfaces; every turn flows through `turnRun`; readiness states (brain, project, executor,
memory/keychain) are shown before work; screen reads are explicit with a visible tell.

## Anti-goals (what roro is NOT)

- No cloud sync, accounts, or telemetry of any kind — measurement is consented, local, human-observed.
- **Cosmetics LAST** — a deferred Phase-3+ revenue layer on the bond, never the product or the wedge.
- No engagement dark-patterns: no needs/decay/guilt/streak mechanics, no persistent bond integer.
- Don't try to *beat* Cursor at raw codegen — compete on memory + privacy + continuity.
- Don't position roro as a "memory API" (a red-ocean lane); embodiment + ownership is the
  uncontested surface — the memory is tied to the pet.
- No always-on surveillance, or UI that implies it.
- No second-species avatar faked in code (a dog needs authored art + visual review).
- No feature bloat or speculative infrastructure built ahead of signal.
- Encrypt-by-default + fail-loud are never traded away for convenience.

## Where the depth lives

- **Engineering truth + work log + conventions:** [`HANDOFF.md`](HANDOFF.md)
- **Launch gates (Path to Public):** [`PUBLIC.md`](PUBLIC.md)
- **Live execution sequencing (arcs, gates, re-plan rule):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Falsified assumptions / expensive lessons:** [`LESSONS.md`](LESSONS.md)
- **Vision tier (pet/companion long arc — aspiration, not sequencing):**
  [`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md)
- **Memory spec:** [`docs/MEMORY-ARCHITECTURE.md`](docs/MEMORY-ARCHITECTURE.md) ·
  [`docs/MEMORY-RESEARCH.md`](docs/MEMORY-RESEARCH.md)
- **Voice (cut from v0, on-device plan of record):**
  [`docs/VOICE-ARCHITECTURE.md`](docs/VOICE-ARCHITECTURE.md)
- **Strategy & research (north-star thinking):** [`docs/strategy/`](docs/strategy/README.md) ·
  the paw-on-the-pixel wedge: [`docs/plans/`](docs/plans/paw-on-the-pixel.md)
- **Setup / run / verification:** [`README.md`](README.md) · [`RUN.md`](RUN.md) ·
  [`docs/VERIFICATION.md`](docs/VERIFICATION.md)
