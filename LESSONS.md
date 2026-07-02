# LESSONS — the falsified-assumptions ledger

> The project's most expensive artifacts: every entry here was paid for with real debugging time, a
> falsified plan, or a near-shipped mistake. Moved verbatim from `HANDOFF.md` §6 (2026-07-01) and
> extended with lessons preserved from deleted design-history docs (sources noted per entry; the full
> originals live in git history). **Do not summarize these away** — the detail is the value.

## Product / strategy

The magic moment is the recalled memory, not the voice. **Job-first, not feeling-first** (the
skeptic's correction): a companion needs a real job; memory makes *that job* stickier. The cert is
for *distribution + durability*, NOT for making memory work. The cosmetics-as-monetization headline
(old handoff) is downgraded — cosmetics are a deferred Phase-3+ layer on the bond, never the wedge.

- **The rejected $25-Pro/cloud-sync model** (preserved from the deleted `MONETIZATION.md`, git
  `de7cd25` — read it there if monetization ever reopens). The durable guardrails that survive the
  rejection, so they aren't re-derived at full price: **never paywall the wedge** (cat, agent-driver,
  full local memory engine stay free); **transparency + Forget are always free and never an upsell
  surface**; **no unbounded hosted compute inside a flat fee** (every hosted surface is a cost *and*
  abuse surface — cap, meter, or degrade-to-local); **memory COGS grows with corpus tenure** (the
  most-retained users are the most expensive and worsening — model cost against the 12–18-month
  cohort, not a fresh user); **right-to-forget must cascade through derived/consolidated artifacts**
  (deleting a source vector does not delete a synthesized derivative — RAG-not-fine-tuning +
  provenance cascade-delete + crypto-shredding for backups); **the cat may want, but never withholds
  or nags**.
- **The WS5 cosmetics fake-door has a pre-registered gate** (preserved from the deleted
  `docs/superpowers/plans/2026-06-22-roro-ws5-cosmetics-validation-plan.md`, git `11a40f4`). The
  fake-door is built (#58, #129) but the experiment has not run (cosmetics deferred Phase-3+). If it
  ever runs, the pre-committed thresholds prevent post-hoc rationalization: **PASS = ≥5% CTA-click at
  $4.99 AND ≥2% notify-me email, within 2 weeks or the first 150 *activated* users (≥3 sessions
  across ≥2 days)** → build the store; AMBIGUOUS → price A/B ($2.99/$4.99/$7.99); **FAIL (CTA ≪ 5%)
  → do not build the store, revisit the thesis.** Weight notify-me over raw clicks (novelty
  click-through inflates clicks).
- **"Memory API" is banned positioning** (preserved from the deleted `docs/ARCHITECTURE.md`, git
  `feaad68`): that lane is a red ocean (Mem0, Zep, Supermemory, Cloudflare Agent Memory, ClawMem —
  which ships bare typed-memory-cross-agent *minus the pet*). Embodiment is roro's only uncontested
  surface — tie memory to the pet and out-craft on personality/animation.

## Engineering / process (hard-won)

- **Test the riskiest assumption *cheapest* and *first*.** The whole PUBLIC.md keystone rested on "a
  signed build fixes memory." A ~10-min, $0 test (a minimal ad-hoc app) **falsified** it before we
  built on it. Real cause: **forge ships an invalid signature** — the FusesPlugin fuse-flip + the
  `extendInfo` (`NSMicrophoneUsageDescription`, *we added* in #61) rewrite `Info.plist` *after* the
  seal → `errSecAuthFailed` → `safeStorage` false. Fixed by a **postPackage ad-hoc re-seal** as the
  last step.
- **A green local suite can lie** — a `void`-dispatched unhandled rejection (extending `MemoryModule`
  broke 4 hand-rolled orchestrator mocks) was green locally, red on CI. *Grep for all mocks when
  extending a shared interface.*
- **`gh run watch --exit-status` lies** — it returned 0 while the run *failed*; we merged a red PR.
  *Poll `gh run view <id> --json conclusion` until `completed/*` and require `success` before
  merging.*
- **A green test can prove nothing** — the first durability test passed spuriously (warm index, never
  reconcile-from-files). *Sabotage a load-bearing test to prove it'd fail.*
- **An eval metric can be dead-on-arrival** — the `bare_boolean` mode was unreachable (the guard
  nulls `"true"` first). *Separate "protect production" (guard) from "measure the model" (eval).*
- **macOS gotchas:** `codesign` with a real cert pops a keychain prompt that *hangs* a
  non-interactive shell (use ad-hoc `--sign -` for local tests). The keychain ACL is
  **cdhash-pinned** for ad-hoc. `safeStorage` works in `npm start` + any *validly*-signed build.
- **Codex review is unreliable here** (`codex exec` hung twice; orphan process — `pkill -9 -f
  "codex exec"`). We use **in-process multi-hat Workflow reviews** (parallel reviewers per dimension
  → per-finding adversarial verify) — every one caught a real bug.
- **Never target "the first window" — target a named registry** (W0 / #135, paw-on-the-pixel). A
  3-hat merge-gate caught a **real P0 that six Codex review rounds missed**: the paw/pointer overlay
  is a *second* `BrowserWindow`, and `getAllWindows()[0]` orders **newest-first**, so the overlay
  silently **hijacked every MAIN→renderer push** — every event hit the preload-less overlay, not the
  cat. Fixed with a named window registry (`src/main/windowRegistry.ts`, `sendToFirstWindow` →
  `sendToPetWindow`). *Generalizable law:* **`getAllWindows()[0]` orders newest-first — a second
  BrowserWindow (an overlay) silently hijacks every main→renderer push; target windows by a named
  registry, never "the first window."**
- **A value-quality eval that only checks token-overlap is blind to inversion** (W3 / #145). The eval
  panel caught a **real P1 by executing the scorer**: a polarity-inverted value scored `ok` ("never
  force push" → "force-pushes…" = `ok`). An inverted memory is *worse* than a missed one — it
  confidently misremembers you. Fix: `ValueContract` gained `mustAlsoContainOneOf` /
  `mustNotContainAnyOf` → a distinct **`inverted`** scorer mode, 14 fixtures guarded, a negation-marker
  CI assertion sabotage-verified. *Generalizable law:* **a value-quality metric that only checks
  token-overlap scores an INVERTED memory ("never force-push" → "force-pushes") as ok — an inverted
  memory is worse than a missed one; the metric must be able to SEE inversion (conjunctive/negation
  contracts).**
- **Never land a security feature on an incomplete review panel** (W6 / #148, the Agent-SDK executor).
  The 3-hat panel came back CLEAR — but its **gate-correctness dimension DIED mid-run** on a model
  session limit. Rather than ship on the partial green, we **re-ran that one dimension, deepened** (3
  sub-lenses: delegate-memoization / stop-abort-teardown / bypass-tripwire) + adversarial verify, and
  *then* landed. *Generalizable law:* **never land a security feature on a review panel where the
  security-correctness dimension didn't complete — re-run the missing dimension.**
- **After merging a dependency-adding PR, re-sync the shared `node_modules`** (the rebuild-program
  env-drift lesson). *Generalizable law:* **after merging a PR that adds a dependency, the local
  shared `node_modules` must be re-synced (`npm install`) or local `tsc`/package silently break while
  CI (`npm ci`) stays green** — a clean CI is not evidence your working copy resolves.

## Voice

- **THE LICENSING LANDMINE (kokoro / phonemizer / eSpeak-ng GPL).** `kokoro-js` AND `phonemizer`
  statically bundle GPLv3 **eSpeak-ng**; `phonemizer` **LIES** — it declares Apache-2.0 in its npm
  metadata but ships eSpeak — making both **unshippable in MIT roro**. The fix: `phonemize@1.2.0`
  (MIT, pure-JS) **pinned exact** + raw-ONNX Kokoro generate (no `kokoro-js`). The CI license
  firewall scans **BUILT-ARTIFACT SYMBOLS** (`espeak_ng_`, `espeakng.worker`) — never package names —
  because **npm license fields are assertions, not facts.**
- **Mouth-not-brain was violated by a shipping default, not merely "at risk"** (preserved from the
  deleted `docs/superpowers/specs/2026-06-21-nero-voice-decision.md`, git `11a40f4`). In the old Vapi
  path, when `vapiAssistantId` was empty (the default), Vapi ran its **own** STT→cloud-LLM→TTS loop
  and spoke a reply **while `turnRun` fired in parallel** — **two brains**, and the one that spoke
  never called recall/decide/remember. That is why HANDOFF invariant "voice is mouth-not-brain"
  exists and why the `VoiceBackend` seam is structurally generate-free (`say(exactText)` only — a
  speech-to-speech model would make the model the brain and bypass the moat).

## Interaction

(Preserved from the deleted `docs/superpowers/` interaction + aliveness specs/plans, git `11a40f4`;
the still-governing design laws are summarized in `docs/INTERACTION.md`. The gaze law is enforced in
current code — `src/renderer/bootstrap.ts` "cursor movement must NOT keep the cat awake".)

- **Never disambiguate gestures by milliseconds.** The old design put the pet-vs-billed-call boundary
  at **~20ms of dwell** across a 350ms mark — a lingering, affectionate press silently started a paid
  cloud voice call. Law: **disambiguate by SURFACE + BUTTON + STATE, never by timing windows**;
  adding a verb means adding a menu item, never another timing window. Corollary: an action's
  *accidental-trigger probability* must be **inversely proportional** to its cost/irreversibility.
- **A "harmless" liveness feature can break a core behavior:** cursor-gaze poked the activity timer
  on every cursor sample, so the cat could never reach `asleep` (near-zero-idle violated). Gaze must
  never wake the cat.

## Memory / embeddings

- **Every cheap substrate stays cheap after the corpus exists — except the embedding vector space,
  which gets costlier per row** (preserved from the deleted
  `docs/superpowers/specs/2026-06-21-nero-substrate-decision.md`, git `11a40f4`). A different embed
  model is a different *geometry* at any width — a same-width swap saves the DDL, not the re-embed;
  any fallback still requires re-embedding every row. This is why every vector carries an
  `embed_model`/`embed_dim` provenance stamp, and why changing embedders means moving/deleting the
  memory dir (see `RUN.md` §2).
- **Compaction/GC of an event-sourced log must never drop ops that carry cross-entry side effects**
  (W5 / #147 — the program's most severe finding, **proven by execution on the PR head**). Manifest
  compaction dropped `replace_fact` `supersedeIds` when a fact was later *reinforced* (routine
  corroboration) → replay resurrected the superseded prior as active → a duplicate-active-fact throw
  *inside* `reconcile` → the store **permanently BRICKED on every open** (`rm -rf index/` can't help —
  the compacted manifest is the *durable* layer); the forget-variant resurrected replaced content back
  into the profile. **955 tests were green** because every tested history ended birth-op-last. Fix:
  exempt fact-tier ops from chain-collapsing (episodes dominate churn; fact history is tiny; replay
  order restores supersede marking) + 3 mandatory red-first regression tests from the verifier's
  executed repro. *Generalizable law:* **GC/compaction of an event-sourced log must never drop ops
  that carry CROSS-ENTRY side effects (e.g. a fact's `supersedeIds` live on the SUCCESSOR's op);
  dropping one bricks replay (duplicate-active-fact) or resurrects a superseded/forgotten value — green
  suites lie unless test histories cover reinforce-after-replace and tombstone-the-successor
  orderings.**
