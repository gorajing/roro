# Roro — Path to Public

> The plan to take Roro from "works on my machine" to a trustworthy first impression in a stranger's hands.
> Synthesized from a 4-lens strategy panel + a 4-dimension public-readiness audit (see git history of this file).

---

## What Roro is (the v0 identity)

**The private, local coding companion that remembers how *you* work.**

Lead with the **job** (a real coding executor that gets better at your patterns over time); let *being known* be the
emergent reward of using it daily — not the pitch. The single feeling to engineer for is **"being known"**: the quiet
relief of not having to re-explain yourself.

- **North star:** opening your laptop feels like being greeted by something that remembers how you work.
- **The moat:** the per-user, **encrypted, on-device** memory — a switching cost, not a network effect — deepened by a
  human-in-the-loop **correction loop** (a user-confirmed fact is 100% true, model-independent, and impossible to clone).
- **Sequence:** job → habit → memory → moat. The job earns the daily open; the daily open builds the corpus; the corpus
  is the moat. Don't try to summon the moat before the job exists.

---

## ⭐ The keystone (read this first)

Every public-readiness assessor independently flagged the **same** #1 risk, and it has a nasty property: **it is
invisible in `npm start` and only appears in a packaged build in a stranger's hands.**

The magic moment (recalled memory) depends on `safeStorage` reaching the macOS Keychain. An **unsigned / ad-hoc**
build *cannot* do this → encrypted memory silently fails to persist → Roro becomes "just another local LLM wrapper that
forgets you."

**A Developer-ID-signed + notarized build resolves BOTH blockers at once** — Gatekeeper-clean install *and* encrypted
memory persistence. So **one signed build either proves or disproves the entire launch thesis in an afternoon.** That is
the cheapest possible test of the riskiest assumption — so we do it **first**.

> ⚠️ Phase 0 is a **hypothesis**, not a certainty. We've proven `safeStorage` works under the dev identity (`npm start`)
> and the macOS keychain mechanism says a *stable* Developer-ID identity should fix the packaged case — but "should" is
> not "did." Validating it is the whole point of Phase 0. If it fails signed, **stop and fix the memory architecture
> before any polish** (do not paper over with a plaintext fallback — that breaks the encrypt-by-default invariant).

---

## ✅ Definition of done (the go/no-go gate)

Roro is public-ready when **all** of these are observed (not code-read):

- [ ] A stranger downloads a Developer-ID-**signed + notarized** `.dmg` and launches it with **zero Gatekeeper warnings**
      (no right-click→Open dance). Verified on a **clean second Mac**, not the build box.
- [ ] The packaged app is runnable **without a terminal**: a native folder-picker sets the working repo, honest
      Ollama/model status with one-click download — no `.env`, no API keys, no shell.
- [ ] `RORO_WORKDIR` persists in `userData/config.json` and survives relaunch; the executor never throws
      "Roro has no working repo set" for a user who completed onboarding.
- [ ] **The heart:** on the signed build, a fact stored in session 1 is recalled in session 2 after a **full quit +
      relaunch** — `safeStorage.isEncryptionAvailable()` is true, the AES-256-GCM envelope round-trips.
- [ ] **A non-founder** observes the magic moment: types a task, Roro recalls a prior fact and uses it, and the recall
      is **correct** (not `- true` garbage).
- [ ] Branded bundle ID (not `com.github.Electron`) + a real app icon (the pixel cat) in Dock/Launchpad.
- [ ] Brain-not-ready and executor-can't-run failures are **loud + actionable in-UI** — never a silent empty window or a
      mid-task surprise or a raw env-var error string.
- [ ] README leads with the **job + a 3-sentence privacy promise** (on-device, encrypted-by-default, no telemetry) — not
      a feature list of face/voice/memory.
- [ ] **Nothing half-baked ships:** voice and Live2D are either fully working behind onboarding *or* fully hidden (no
      dead "relaunch with RORO_STT_VOICE=1" hints). A stranger sees nothing they can't actually use.

---

## The path (riskiest truth validated first, not last)

### Phase 0 — Prove the magic moment survives a signed build (the keystone)
**Goal:** answer the one question the whole launch rests on, before any polish, gated only on the Apple cert.
- Founder provisions the paid Apple Developer Program + a **Developer ID Application** certificate. Set
  `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`. *(The free "Apple Development" cert is explicitly rejected by the
  `assertSigningIdentity` preflight — it produces an ad-hoc signature where `safeStorage` fails.)*
- Run `npm run make` with the three creds set. The signing pipeline (`src/build/macSigning.ts` +
  `build/entitlements.mac.plist` + the notarytool path) is **already wired** — no new code.
- On a **second clean Mac**: install the `.dmg`, launch, confirm no Gatekeeper warning.
- Store a fact → **fully quit** → relaunch → confirm the fact is recalled. (Collapses the two scariest blockers —
  signing + `safeStorage` — into one observed outcome.)
- **If `safeStorage` is still unavailable signed: STOP.** Decide the fallback before proceeding.

**Exit:** a non-founder installs the signed `.dmg` on a clean Mac, no warning, and observes a fact recalled across a full
quit. The magic moment works outside `npm start`.

### Phase 1 — Make the packaged app runnable without a terminal (the onboarding spine)
**Goal:** take a stranger from launch → a successful coding turn, no shell. *(All memory-architecture-independent —
buildable in parallel with Phase 0.)*
- `userData/config.json` read/write for `RORO_WORKDIR` (mirror the `identity.ts` `app.getPath('userData')` pattern);
  `resolveWorkdir` and `window.ts` source it instead of only `process.env`.
- First-run flow: no workdir → native folder-picker ("Which project should Roro work on?") → persist; a Settings entry to
  change it later. Not skippable.
- Wire the **existing** `bootstrapBanner` into the boot path so Ollama-down / models-missing is clear and the one-click
  download is reachable — gate the first turn until the brain is ready, or make "not ready" an unmistakable in-UI block.
- Replace the raw "Roro has no working repo set" throw with an in-UI actionable prompt.
- Branded `appBundleId` + app icon in `forge.config.ts` (`.icns` from a 1024px pixel-cat PNG).

**Exit:** a stranger who has never touched a terminal launches → is guided to pick a repo → sees honest model status with
one-click download → types a task the executor runs to completion. Dock shows the cat icon.

### Phase 2 — Trust the first impression (correctness + honest framing)
**Goal:** make the moment *land* and feel trustworthy, not lucky. *(Correction loop is memory-dependent — do it after
Phase 0 confirms memory persists signed.)*
- **Expose the correction loop** (the moat): `reinforceFact` / `replaceFact` / `supersede` over the preload bridge + IPC;
  extend the Forget panel so a recalled fact can be **corrected/verified**, not only deleted. Privacy *with* agency.
- Never recall a `- true` / bare-boolean line (the guard prevents storage; ensure recall never surfaces noise).
- Nudge DECIDE toward **clarify** on referent-less requests ("fix it", "make it better") via the system prompt — bias to
  asking over guessing. Re-run the eval to confirm clarify rose without tanking decide accuracy.
- Rewrite the README to lead with the **job + privacy promise** + a `RORO_WORKDIR` troubleshooting line.
- A visible **"Roro is looking at your screen"** tell before the first vision capture (the creepy↔care line).

**Exit:** a stranger's first turn lands a *correct* recalled fact or honestly asks to clarify (never a confident wrong
guess); a wrong fact is fixable in-UI in one action; the README describes the job + privacy, not a feature list.

### Phase 3 — Debut to a small, honest audience and measure attachment
**Goal:** learn the only thing that matters — does the moment land for people who aren't you, and do they come back?
- **Channel (founder decision):** a small trusted cohort (friends + one AI/dev community) over a broad post — narrow
  enough to watch every first-run.
- Ask each tester three things: (1) did the magic moment land? (2) onboarding/`RORO_WORKDIR` friction? (3) will you reopen
  it next week?
- Capture `RORO_TRACE` from real first turns to seed the eval with real ambiguous requests (today's fixtures are synthetic).
- Triage: any first-run blocker is a same-day fix; cosmetic/feature requests go to the post-public backlog.

**Exit:** a majority of the cohort reaches the magic moment unaided on the signed build **and at least some reopen a
second day.** Real traces captured; showstoppers fixed.

---

## ✂️ Not for v0 (the discipline)

v0 is **one thing done well: the remembering coding companion.** Deliberately cut:

- **Voice (STT/VAD/TTS)** — heavy, behind dev flags, the riskiest on-device surface. Ship OFF and **hidden** (remove the
  dead "relaunch with RORO_STT_VOICE=1" hint).
- **Live2D avatar** — the procedural pixel cat is charming + complete; it *is* the v0 identity. A half-integrated model
  deepens the "unfinished" impression.
- **Cosmetics store / pet variants** (WS5) — code-complete but fake-door. Monetization is post-PMF; validating the moment
  comes first.
- **Windows / Linux** — the whole trust stack (hardened runtime, notarization, `safeStorage`) is macOS-first and proven
  there. Port after the macOS moment is validated.
- **Cloud-brain option** (`BRAIN_PROVIDER=nebius`) — works in code, but adds an API-key path and dilutes the
  "on-device by default, zero network calls" promise. Keep it an undocumented power-user env var.
- **Ambient / clipboard proactivity** ("I notice you copied an error") — raises consent/creepiness stakes before basic
  trust is established. Wrong order.

---

## 🔑 Founder decisions

| Decision | Recommendation |
|---|---|
| **Provision the paid Apple Developer Program + Developer ID cert** | **Do this FIRST, this week.** ~$99/yr. The keystone — it unblocks Gatekeeper-clean install AND encrypted memory at once. The pipeline is coded and waiting on exactly this one input. |
| **Bundle ID + icon** | `com.jinchoi.roro` + the black pixel cat you already have, rendered at 1024px → `.icns`. Don't design a new brand; ship the cat. |
| **`RORO_WORKDIR` setup UX** | A mandatory first-launch native folder-picker (the gate between "launched" and "can code") + a Settings entry to change later. |
| **Debut channel** | A small trusted cohort first — measure attachment (does the moment land, do they reopen), not vanity downloads. Broaden only after it lands for strangers. |
| **The go/no-go bar** | Phase 0's exit, hardened: a non-founder, clean Mac, signed `.dmg`, fact recalled across a full quit. If that one thing isn't true, **nothing ships.** |

---

## 🚨 Biggest risk

The magic moment (encrypted memory recall) **not surviving** the jump from `npm start` to a signed packaged build. It's
invisible in development and only manifests in a stranger's hands; if it fails, the entire "being known" moat silently
evaporates. The plan front-loads it as **Phase 0** — gated only on the cert (a founder action), provable in an afternoon.

## The first thing to do

**Provision the paid Apple Developer Program + create a Developer ID Application certificate**, then run `npm run make`
with the three creds set to produce the first signed + notarized build. Nothing else on the path can be *truly validated*
until this build exists. The memory-independent Phase-1 spine (configStore, onboarding, icon, README, clarify nudge) can be
built in parallel; the memory-dependent correction loop waits for Phase 0 to confirm memory persists signed.
