> **HISTORICAL / SUPERSEDED — see [HANDOFF.md](HANDOFF.md) and [PUBLIC.md](PUBLIC.md).** This is the hardened
> $25-Pro/sync model, kept as the record of why cloud sync/account monetization was rejected for v0. The current launch
> canon is local-first, job-first, and trust/memory-first; cosmetics or voice packs are future validation hypotheses, not
> the v0 wedge or public-readiness path.

# Roro Monetization Spec — v2 (Hardened)

*Lead synthesis of four tier evaluations, hardened against three adversarial reviews (margin/pricing, conversion/cannibalization, abuse/privacy/legal). Every critical and major finding integrated. Launch-blocking items flagged in §11.*

---

## 1. PRINCIPLE

**The entire product runs on the user's machine, with the user's keys, for free — forever. We sell the moat, never the compute.** Everything local has zero marginal cost to us, so giving it away in full is the acquisition and retention engine: the cat, the agent-driver, the *complete* typed-confidence/supersede memory engine, `PROFILE.md`, transparency/forget, and the local MCP bridge are all free and MIT-licensed. Pro is the same app — one binary, one install — where logging in unlocks exactly the things a single local machine *structurally cannot do for itself*: your memory **surviving, syncing, backing up, and acting across machines**, a **real/own voice**, a **personal model that is you** (RAG, never fine-tuning), and **run-while-away** execution on our infra. Free is the wedge and must stay excellent.

Two hard economic truths govern everything below, and the v1 draft violated both:
1. **COGS is not flat — it grows with corpus tenure.** A memory product's most-retained users are also its most expensive, and getting more so every month. We model cost as a function of corpus age and usage distribution, not a single "typical user."
2. **Every hosted surface is a cost surface and an abuse surface.** Voice, consolidation, personal-model inference, and run-while-away are *all* metered, capped, or degrade-to-local — not just run-while-away. There is no unbounded hosted compute inside the flat fee.

---

## 2. THE TIER TABLE

| Capability | Free (MIT, local, BYO keys) | Pro ($25/mo) | Lights up in |
|---|---|---|---|
| Cat companion (presence, reactions) | ✅ never gated | ✅ | Phase 0 |
| Drives-your-agent (Claude Code/Cursor/etc.) | ✅ full | ✅ | Phase 0 |
| Local memory — **full** confidence/supersede engine | ✅ full | ✅ | Phase 0 |
| `.roro/PROFILE.md` (portable, git-committable) | ✅ | ✅ | Phase 0 |
| Transparency panel + hard Forget | ✅ **always free** | ✅ | Phase 0 |
| Local stdio MCP server (cross-agent bridge) | ✅ | ✅ | Phase 0 |
| Local voice (on-device STT/TTS, default voices) | ✅ when it ships (D.2) | ✅ | Phase 2 |
| One-time premium-voice **preview** (60s, per verified acct) | ✅ taste-only | — | Phase 1 |
| **Durability / managed backup** of memory | ❌ | ✅ **universal-reach trigger** | Phase 1 |
| **Cross-device + cross-machine sync** | ❌ | ✅ | Phase 1 |
| **Premium hosted voice** (capped allotment) | ❌ | ✅ | Phase 1 |
| **Cloned (own) voice** (biometric-gated, see §8) | ❌ | ✅ | Phase 2 |
| **Personal model** (RAG, see §8) — retention/expansion | ❌ | ✅ (corpus-gated) | Phase 2 |
| Background memory consolidation (hosted, **capped**) | ❌ | ✅ | Phase 2 |
| **Run-while-away** (hosted execution) | ❌ | ✅ via metered add-on | Phase 3 |
| Remote MCP (memory served to agents on *other* machines) | ❌ (sync-adjacent) | ✅ | Phase 1 |
| Team / shared-org memory | ❌ | Phase-3 capability (priced, not yet built) | Phase 3 |

**Build-phase order:** Phase 0 = Free-only launch (no payments, drive organic pull). Phase 1 = accounts + **backup/durability** + sync + premium voice + voice preview (first dollar). Phase 2 = cloned voice + personal model + local voice + consolidation. Phase 3 = run-while-away + Team.

---

## 3. FREE — DETAILED

Free is a complete, lovable product, MIT-licensed, BYO-keys, running entirely local. Every Free feature is $0 to us because there is **no hosted dependency and no marginal cost**.

- **Cat companion** — the emotional wedge. $0: pure local rendering.
- **Drives-your-agent** — turns intent into actions against the user's own agent via the user's own API keys. $0: the user pays their own model bills.
- **Full local memory engine — typed confidence + supersede/conflict resolution.** $0: local computation. The whole engine ships free; a degraded free memory would teach users the product is mediocre and kill the retention loop. Pro's memory story is *not* "better memory" — it is "your memory, everywhere, backed up, and distilled into a model that is you."
- **`PROFILE.md`** — human-readable, git-committable, portable forever. $0. The anti-lock-in proof point (§9).
- **Transparency + Forget** — see everything remembered with confidence + provenance; hard delete. $0. **Guardrail: always free, never an upsell surface.**
- **Local stdio MCP server** — exposes Roro's memory/profile to any MCP-speaking agent on the same machine. $0. This is FREE — it is how Roro spreads inside a developer's toolchain. (The *remote* MCP variant — serving memory over the network — is sync-adjacent and therefore Pro.)
- **Local voice (Phase 2 / D.2)** — on-device STT/TTS with default system voices. $0 when it ships.
- **One-time premium-voice preview** — a strictly bounded, **60-second, one-time, per-verified-account** sample so every user *hears* the value before the paywall. This is a sub-cent one-time CAC, not a subsidized usage tier — it does not breach "never subsidize ongoing hosted compute." (Resolves the cold-sell problem in §6; see §11.)

**OSS / self-host story.** The Free client is **MIT** — permissive, maximally forkable. We deliberately do **not** use AGPL or BSL: the moat is hosted infrastructure + accounts + data gravity + trust, not source restriction. A fork *can* self-host sync if they rebuild the entire backend — fine and expected. Restrictive licensing would chill exactly the developer adoption that is the wedge.

---

## 4. PRO — DETAILED

**Pro = $25/mo flat, single price, no seats at v1.** Each feature is a *capability gate*, never a throttle on the free core. **Every hosted surface below is bounded** — there is no uncapped hosted compute in the flat fee.

| Pro feature | Median COGS/mo | Bound / enforcement | Upgrade trigger |
|---|---|---|---|
| Durability / managed backup | ~$0.40 (grows w/ corpus) | crypto-shred on delete; tiered cold storage | **Corpus-maturity loss-aversion (universal reach)** |
| Cross-device + cross-machine sync | ~$0.70 (grows w/ corpus) | corpus compaction; cold-storage stale vectors | **Second-device install** |
| Premium voice (capped allotment) | ~$2.50–$7.20 (see §5) | hard minute cap + degrade-to-local | Premium-voice preview |
| Cloned (own) voice | (in voice line) | biometric consent gate (§8) | Voice settings, post-attachment |
| Personal model (RAG) | ~$2.00–$5.00 (usage-driven) | per-query retrieval cap + context bound | **Corpus maturity** (retention feature) |
| Hosted consolidation | ~$1.50 (**capped**) | N runs/mo + token/run budget, degrade-to-queue | Bundled |
| Hosted-brain inference (RAG/serving) | (in personal-model line) | per-account daily token budget + anomaly detection | Bundled |
| Stripe + chargeback/refund reserve | ~$1.25 | — | — |
| Support / ops (placeholder) | ~$1.25 | founder-absorbed early; real at scale | — |

**The COGS lines above are median-user; the planning margin is fleet-blended and lower — see §5.** The bounds are not aspirational: they are the mechanism that makes the flat fee solvent, and several are launch-gating (§11).

### Hosted surfaces are ALL bounded (not just run-while-away)

The v1 draft capped only run-while-away and left consolidation + personal-model inference as uncapped hosted compute inside the flat fee — a farmable LLM-proxy hole and a margin liability. Corrected:

- **Hosted consolidation:** explicit **frequency cap (N runs/account/mo)** + **per-run token budget**; past the cap, consolidation **degrades to a deferred queue**, never runs unbounded. Treated under the same provider-layer enforcement as run-while-away.
- **Hosted-brain / personal-model inference (RAG serving):** **per-account daily token budget** + **per-query retrieval/context-size bound** + anomaly detection; breach **degrades to local**. This closes the "$25 account as cheap general-purpose LLM proxy" abuse (a ring of $25 accounts looping the endpoint).
- **Premium voice:** hard **minute cap**; past it, falls back to zero-COGS on-device TTS or routes to the metered add-on by user choice.

### The metered hosted-execution add-on (run-while-away)

**The one place we touch arbitrary hosted execution, and it is NOT in the flat fee.** Separate, opt-in, metered.

- **Pricing:** provider cost **+ 30%**, **net of the Stripe fee on the metered charge** — the markup must absorb its own payment processing or the effective margin is <30%. Per-unit profitable.
- **Default state:** **OFF**. User must explicitly enable it *and* name a monthly ceiling. Default cap **$0**.
- **Enforcement — transactional, not post-hoc (LAUNCH-GATING, §11):** each sandbox start is **gated on a real-time spend check with a pre-committed budget reservation** (reserve budget before start, decrement on completion) via a **metering proxy in front of E2B**. We do **not** rely on cloud-provider post-hoc spend reporting, which is near-real-time at best and fails open under the 10-concurrent / 100-starts-hour limits this spec allows. *"$25 can never go negative" is only true once refuse-at-limit is transactional — until then the claim is false and run-while-away does not ship.*
- **Hard caps:** default **$50/account/day**, **$500/account/month**, plus a **cohort-level global daily spend circuit breaker** that trips on anomalous aggregate growth (defends against fraud rings).
- **At cap:** jobs **refused** with a clear message — never a silent overrun.
- **Collectability gate:** a **pre-authorization hold sized to the daily cap** (not a $1 auth) so a runaway is collectable; require **successful settlement** (not just auth) before any account rises above new-account half-caps. New accounts (<7 days) get half caps and cannot raise them. (This is a fraud/velocity control, **not** "KYC" — see §8.)
- **Local execution is always free and uncapped.**

*Resolved (Tier 1 "20 hrs included" vs Tier 2 "cost+30%, default $0"):* **no bundled execution hours**, cost+30% net-of-Stripe, default-$0 opt-in cap, transactional provider-layer caps. Bundling execution risks a single looping agent going margin-negative.

### In-product upgrade copy (only at the capability boundary)
- Backup (universal): *"You've taught Roro 200 things. Right now they live only on this machine. Back them up — Pro."*
- Sync: *"Roro remembers you here. Want Roro everywhere? Sync across devices — Pro."*
- Voice: *"That preview was the real voice. Hear Roro — or your own — anytime, with Pro."*
- Personal model (cat, in-character, once): *"I've been paying attention. I think I finally get how you work — I could become *your* model now."*
- Run-while-away: *"Close your laptop. Roro keeps working. Pro."* (included-meter visible)
- Forget/transparency (free, reassurance): *"This is everything Roro remembers, and where it learned it. Forget anything, anytime. Always free."*

---

## 5. PRICING and MARGIN

**Price: $25/mo or $250/yr** (2 months free, ~17% off). Single price, **no seats at v1.** **$25 is a planning anchor, not a settled fact — it is downstream of corrected COGS and must be WTP-validated (see below and §11).**

*Resolved (the widest conflict — $8-12 vs $20 vs $24 vs $25):* We plan at **$25** on Tier 2's economics. $8-12 does not clear corrected COGS. $20 signals commodity parity. $25 sits one notch above the $20 commodity tier, under the $30 wall. But the v1 "63% gross margin" was optimistic on three counts the reviews caught — fixed below.

### Three corrections to the v1 margin

**(a) Median ≠ fleet.** The v1 63% used single-point "typical" usage on *every* metered line simultaneously — a composition error. The honest planning number is **fleet-blended expected value** across a usage distribution. Modeling **70% light / 20% medium / 10% heavy**:

| Cohort | Voice | Personal model | Consolidation | Sync+backup | Blended COGS |
|---|---|---|---|---|---|
| Light (70%) | ~$1.00 | ~$1.00 | ~$0.80 | ~$0.80 | ~$3.6 + fixed |
| Medium (20%) | ~$3.00 | ~$3.00 | ~$1.50 | ~$1.40 | ~$8.9 + fixed |
| Heavy (10%) | ~$7.20 | ~$5.00 | ~$2.50 | ~$2.50 | ~$17.2 + fixed |

Adding Stripe+reserve (~$1.25) and support placeholder (~$1.25) to each, the **fleet-blended COGS is ≈ $9.5–$11/user/mo**, i.e. a **planning contribution margin of ~56–58%, support-excluded; ~50–55% fully loaded.** **Use ~55% as the planning figure. 63% is the median-user illustration only.**

**(b) The converting cohort is heavier than the fleet.** The users who convert are the most engaged — they self-select toward the medium/heavy tail. The **converting cohort's blended COGS is ~$12–$14**, so gross profit per *converter* is **~$11–$13/mo, not $15.77.** Break-even must use the converter's COGS, not the all-user average.

**(c) Voice is the single most-underwater line.** v1 booked premium voice at $2.50 using **$0.03/min** — that is commodity STT-only pricing, not the premium/cloned neural TTS the product promises. Realistic 2026 blended STT + premium/clone TTS is **$0.06–$0.12/min**. At $0.08/min × 90 min = **$7.20**, ~3× the booked cost. **Decision: cap the included premium-voice allotment at ~30–45 min** so the median voice line stays near $2.50; heavy voice degrades to local TTS or the metered add-on. **Do not ship the $0.03/min assumption — re-quote the vendor first (§11).**

### Corpus-growth COGS (the structural decay v1 never modeled)

Memory accumulates monotonically by design; sync + vector-index hosting + managed backup **grow every month a user stays**, while revenue stays flat. The most valuable, longest-retained users are the most expensive and worsening. Mandatory cost-model defenses, **launch-gating for the economics**:
- **Crypto-shredding** for deletes (per-account key destroyed → backups unreadable without rewrite; also the §8 GDPR mechanism — one design, two wins).
- **Tiered cold storage + lazy-load** for stale vectors and idle accounts so the storage line does **not** scale with the inactive base.
- **Corpus compaction / stale-vector tiering** so an 18-month corpus does not linearly inflate per-query retrieval cost.
- **Per-account stored-corpus soft ceiling** with compaction beyond it.
- **Re-derive margin for the 12–18-month-tenured cohort, not a fresh user — that cohort sets LTV.**

### Break-even (honest)

- Fixed infra (~$100–300/mo) is genuinely a rounding error (**7–19 users**) — but this is *fixed* infra, which is **not** the cost story. The cost story is **variable, corpus-scaling COGS on the retained base.**
- Real target: $8k/mo founder draw + ~$300 infra ≈ **$8.3k burn.** At the corrected **converter gross profit of ~$11–$13/mo**, break-even is **~640–750 Pro users (~$16–19k MRR)**, not 520. Present as a range across the usage distribution, not a single figure.

### Sensitivity & guardrails
- Voice-heavy users bounded by the **30–45 min cap** + degrade-to-local. Monitor voice-minutes **p90/p99** weekly from day 1; if p90 > cap, lower the allotment or route overflow to the meter — **never raise price.**
- Personal-model heavy users bounded by the **per-query retrieval cap + daily token budget**; extra retrains bill against the metered add-on.
- Instrument retrain frequency and consolidation runs p90/p99 from day 1; the margin floor depends entirely on these caps holding **for the exact cohort that pays.**

### WTP is not yet validated
$25 is positioning logic, not demonstrated demand. Roro is **incremental** spend on top of a developer's existing $20–40/mo AI bill (they still pay their own model via BYO-keys) — a harder sell than "commodity parity." **The freemium-forever model is the WTP instrument: A/B $15 / $20 / $25 against activated users at day 60 before treating $25 as settled.** If corrected COGS stays high *and* WTP lands at $15–18, the answer is **cut COGS** (smaller voice allotment, capped consolidation, corpus compaction) — not defend $25 by assertion (§11).

### Team motion
**Price for it, defer the build to Phase 3.** Teams convert far higher (15–25% once a second person wants shared memory). Target **~$20/seat (3+ seats)**, shared-org memory. Trigger to build: **3+ inbound team asks in first 90 days.** A team DPA + controller/processor roles must exist before the first team deal (§8).

---

## 6. CONVERSION and RETENTION

**Model: freemium-forever, NOT a time-boxed Pro trial.** A calendar trial exposes sync/model before the corpus and switching cost exist, then yanks them. The free tier **is** the trial. **One exception:** a **7-day Pro trial triggered by the second-device install event** — contextual, fired at a real intent moment.

### The full funnel — with survival modeled (v1 omitted this; LAUNCH-GATING, §11)

v1 computed "520 Pro users is modest" without ever sizing the installs required, silently borrowing a *paying-customer 12-month* retention number (70%) as if it were *free-install-to-day-60* survival. Corrected waterfall, with a **stated survival assumption at each stage**:

| Stage | Assumption | Of 100k installs |
|---|---|---|
| Install | — | 100,000 |
| Activated (first recall ≤72h/3 sessions) | 55% | 55,000 |
| Retained to day 30 | ~50% of activated | 27,500 |
| **Retained to day 60 (free-install survival)** | **~30–40% of activated** | **~16,500–22,000** |
| Pro conversion (**blended 3%**, of surviving activated) | 3% | **~500–660** |

**Back-out:** to clear ~640–750 Pro users at **3% blended** conversion and ~30–40% day-60 survival of activated installs, the required top-of-funnel is **~110,000–150,000 installs**, zero-paid-acquisition, over 12–18 months. That is the real number the bootstrap thesis rests on. **If organic installs cannot plausibly reach that, the thesis fails — and price must rise or a soft limit must be introduced. Decide this BEFORE launch, not after observing it.**

### Metrics (each metered, with named guardrail targets)
- **Activation — "first recall":** % of installs where the cat references a prior session unprompted within **72h / 3 sessions. Target 55–65%.** The one number to obsess over. If < 50%, fix onboarding before anything else.
- **Free-user survival (new explicit guardrail):** **≥40% of activated free users still active at day 60.** If below, the install requirement balloons and the bootstrap thesis is at risk — escalate before scaling acquisition.
- **Conversion:** plan against the **conservative blended 3%** (of surviving activated, at day 60). Treat **4–7%** as *upside*, not the plan. The break-even table (§5) is run at 3%.

### The four orthogonal upgrade gates (v1 had three; the fourth fixes the reach hole)

The real cannibalization risk is **not** "Free is too good" — it is that the v1 triggers don't *reach* most users. Sizing reach as a fraction of activated installs:

1. **Durability / backup (NEW — universal reach, ~100%).** Every user has exactly one irreplaceable corpus on one disk. This is the loss-aversion lever that covers the **single-device majority** the other three miss. Fired at a corpus-maturity milestone, in the cat's voice. *This is the structural fix for the reach gap.*
2. **Second-device sync (reaches only multi-device users).** v1 assumed this is ~50% of conversions, but it only fires for users who run Roro on a second machine. **We must size the % of installs that ever reach device 2; if under ~40%, this cannot be the primary driver** — backup carries the single-device cohort instead. Empty-state copy on a new machine; shown once.
3. **Premium / cloned voice (reaches ~100% in-app).** Now warmed by the **60s one-time preview** so the user has *heard* the value before the paywall (v1 sold this cold). Inline at preview.
4. **Personal model (reaches only deep power users; ≥40 sessions / ≥20 active days).** **Reclassified: this is a retention/expansion feature, NOT a primary conversion driver.** It cannot convert anyone in month 1 and reaches only the most-retained cohort (who likely already converted on backup/sync/voice). **Pricing must clear $25 on backup + sync + voice alone** — verified in §5. The cat surfaces it once, in-character, as "graduating," re-accessible in a "Make me yours" settings entry; never re-nagged.

**Personal-model cold-start & kill-criterion:** the model needs a corpus (a model trained on 3 sessions is worse than base), so it is gated on **corpus maturity, not calendar** (~3–4 weeks daily / ~6–8 weeks for 3×/week users). Ship a **side-by-side preview** ("here's me, here's *your* me"). **Pre-launch kill-criterion:** if the offline quality delta vs base is below a stated threshold, **the model is not marketed as a Pro pillar at all**, the offer threshold is raised, and pricing holds on the other three gates.

**Where the cat surfaces Pro:** only at genuine capability boundaries. **Never** mid-task, never as interstitials, never on the free wedge, never on transparency/forget. The cat may *want* ("I'd love to come everywhere with you") but never withholds or nags. Track prompt-dismissal and uninstall-after-prompt as guardrails.

### Why the free wedge does not cannibalize
Memory is the **switching-cost generator** and the free tier's job is to accelerate corpus accumulation. Org-pull devtools retain far better than FOMO-sold tools; **retention is the multiplier on every conversion path.** Because Free runs entirely on-device, it is a **loss-leader with no loss.** The correct risk to carry is "Free is so good few upgrade"; the answer is the **four genuinely infra-bound gates** (now including universal-reach backup) plus the team motion — **not clawing features out of Free.** If day-60 blended conversion sits below ~3%, A/B gate copy/placement and price first; weakening Free is the last resort.

---

## 7. FREE-TO-PRO MIGRATION (the re-embed)

Local embedding geometry ≠ hosted geometry. The portable artifact is **TEXT + an (embed_model, embed_dim) stamp**; the server **always re-embeds from text**, ignoring incoming client vectors (invariant — never trust client vectors into a different geometry). Re-embedding is the cost.

**Timing:** a 50k-chunk corpus at ~1k/batch is **minutes-to-low-tens-of-minutes.** Migration is a **background, resumable job — never a blocking modal.** Memory stays **queryable during migration** (serve from what's already embedded, fall back to local).

**What the user sees:** *"Importing your memory — 12,400 / 50,000 facts ready. You can keep working; new facts are saved locally and will sync."*

**Orphaning prevention (the killer risk):**
- Upload is **content-addressed** (hash of text) → idempotent; re-runs never duplicate.
- Each chunk has a state machine: **pending → embedded → verified.** Migration is "done" only when **verified count == source count.**
- **Local is the source of truth and is NEVER deleted** until server-side verified-complete is confirmed *and* acknowledged. A crash resumes from pending; a partial upload cannot strand memory.

**Failure visibility (fail loud):** if N chunks fail, they are surfaced explicitly — *"47 facts couldn't be imported, retry / download them"* — never silently dropped.

---

## 8. ABUSE / PRIVACY / LEGAL

### Hosted-execution caps + sandboxing (highest-severity surface)
All enforced **outside app logic**:
1. **Transactional spend ceiling (LAUNCH-GATING):** each sandbox start gated on a **real-time spend check with pre-committed budget reservation** via a **metering proxy in front of E2B** — not cloud post-hoc reporting. Default **$50/day, $500/mo**; above cap → refused. Plus a **cohort-level global daily circuit breaker** on anomalous aggregate growth.
2. **Per-run sandbox limits:** max 4 vCPU, 4 GB RAM, 15-min wall-clock, **no inbound network**, no GPU, ephemeral FS wiped on exit. Sustained-100%-CPU-no-I/O heuristic kills the sandbox (mining detector).
3. **Egress — NOT a static allowlist (corrected).** A coding agent must clone arbitrary remotes, hit arbitrary indices, and call APIs the code-under-test talks to; a "registries + our API" allowlist either breaks real coding work or gets widened until meaningless, and a malicious package published to an allowed registry exfils anyway. Instead: **default-deny egress with a per-job policy the user authorizes**, **DNS/SNI logging**, and **volumetric anomaly detection on egress bytes** (bulk exfil and mining both show as sustained outbound), paired with the CPU heuristic. Egress is *detected and per-job-scoped*, not statically allowlisted. **(LAUNCH-GATING for run-while-away.)**
4. **Token ceilings:** per-account default 2M tokens/day; per-run budget 200k; loop-detector halts the same tool call after >8×.
5. **Rate limits:** 10 concurrent sandboxes/account, 100 starts/hour, exponential backoff; **lower concurrency for new/low-trust accounts.**
6. **Fraud/velocity gate (NOT "KYC"):** "card-on-file + $1 auth" is a card-validity check, trivially beaten by prepaid/virtual/stolen cards — calling it KYC is wrong. Add **device fingerprint, ASN, disposable-email + prepaid-BIN blocking**, require **successful settlement (not just auth)** before raising any account above new-account half-caps, and model **chargeback exposure in COGS** ($15/chargeback; one wipes ~a user-month). Does not gate the wedge — local execution is always free.
7. **Confused-deputy defense (corrected).** Moving secrets into a broker the sandbox calls *through* stops secret *theft* but not *abuse of authority*: malicious repo code can still make the broker push/deploy/delete with the agent's live creds. Therefore: **broker creds are scoped per-job to least privilege (read-only by default, write only to an explicitly named target)**, **state-changing broker calls (push/deploy/delete) require out-of-band user confirmation**, broker actions are **rate-limited**, and the **destructive-command denylist covers broker-mediated actions**, not just shell commands.

### Right-to-forget propagation (LAUNCH-BLOCKING)
A delete must hard-delete the **vector + source text + derived embeddings + backups within 30 days** (CCPA/GDPR), with a deletion receipt. Soft-delete/tombstone is insufficient.

**Personal model = RAG, never fine-tuning at launch.** A fact memorized in fine-tuned weights is effectively undeletable without retraining = a **GDPR Art. 17 deletion gap.** Ship **RAG over the user's vector store**; "forget" = delete the vector. If fine-tuning is ever added it must be per-user LoRA cheaply retrained on a forget event, on a documented ≤30-day max-staleness rebuild, never the only copy of a fact. **Confirm v1 does not implement the personal model as fine-tuning anywhere; if it does, rip it out for RAG before launch.**

**RAG is necessary but NOT sufficient — consolidation reintroduces the gap (corrected, LAUNCH-GATING).** Hosted "background consolidation" *synthesizes new facts from old ones*; deleting one source vector does **not** delete a consolidated derivative that absorbed it, so the v1 rule "delete the vector and the fact is gone" is **false for derived memory.** Required:
- A **derivation-provenance graph:** every consolidated/derived fact stores **hard links to its source chunk IDs.**
- A forget event **cascade-deletes or re-derives every downstream artifact**, not just the leaf vector.
- A **disclosed max-staleness window** for consolidation rebuilds (consistent with the fine-tuning discipline).
- **Launch gate: either prove cascade-delete on consolidated memory, OR launch with consolidation OFF.**

**Backup deletion mechanism = crypto-shredding (corrected).** Promising selective hard-delete from **immutable/WORM** backups in 30 days is a promise the architecture can't keep. Instead: **per-account encryption key destroyed on delete → backups become unreadable without rewrite.** Aligns with the per-account-key model and the §5 cost-model defense — one mechanism, GDPR + cost win.

### Data confidentiality — precise, not overstated (corrected)
The hosted brain processes **plaintext memory server-side** to consolidate and run RAG; encryption-at-rest does **not** protect data *in use*. So: **encryption-at-rest + per-account keys + enforced access policy + break-glass with audit logging and customer notification — this is a process control, NOT zero-knowledge.** Marketing must not imply we *technically cannot* see synced content once it is processed. Let users **mark sensitive memory local-only** (sync-ineligible) — this both honors the trust positioning and shrinks the source-derived-data liability below.

### Source-derived data liability (NEW — decide before first dollar)
Synced memory derives from developers' codebases: employer IP, NDA'd third-party code, incidental secrets, PII. Roro becomes a processor of other parties' confidential data. Required at Phase 1 sync:
- **Secret-scanning + redaction on ingest** (block known key/token patterns from ever syncing).
- **ToS warranty + indemnity:** the user warrants they have the right to upload synced content.
- **Data-classification notice in onboarding:** *"Do not sync code you are not authorized to send to a third party."*
- A **baseline DPA available to individual Pro users**, not just teams.

### Cloned voice = regulated biometric data (corrected severity — gates cloned-voice ship, not Phase 0/1)
A self-attestation checkbox is not a defensible control. Voiceprints implicate **Illinois BIPA** (written consent, published retention/destruction schedule, **no-profit-from-biometrics** — selling a clone as a Pro feature implicates this), the **ELVIS Act (TN)**, **CA AB 602/AB 1836**, and **EU AI Act** deepfake/biometric provisions. The abuse case is cloning *someone else's* voice, which attestation cannot prevent. Required before Phase 2 cloned-voice ship:
- **Liveness / challenge-phrase verification** that the enrolled speaker is the consenting account holder.
- **Published BIPA-compliant retention + destruction schedule.**
- **Geo-gate Illinois** or obtain BIPA-grade written consent; **counsel sign-off on the no-profit-from-biometrics question.**

### Data residency / GDPR
Launch **US-only, disclosed honestly.** Build the **account-level region-pinning hook now** (region attribute) so EU residency isn't a re-architecture later. **Do not claim EU residency until it exists.** Build the **team DPA + controller/processor role definitions before the first EU team deal.**

### Liability (destructive commands)
(a) Destructive-pattern **confirmation gate ON by default** for a denylist (`rm -rf`, force-push, prod deploy) — **user-extensible, never user-shrinkable below the default floor**, and **covering broker-mediated actions**; (b) hosted sandbox **cannot touch the real machine/prod**; (c) dry-run/preview for flagged local commands; (d) ToS limitation-of-liability + explicit **"you supervise this agent" acknowledgment at first agentic run.**

---

## 9. COMPETITIVE MOAT (vs Cursor / Anthropic / OpenAI / GitHub)

Assume any single **feature** is cloneable in a quarter. The moat is three compounding, structurally-hard-to-copy things:

1. **The accumulated per-user memory corpus.** Switching cost grows with every captured fact; an 18-month corpus does not restart elsewhere. Free's job is to **accelerate corpus accumulation before incumbents arrive.**
2. **Local-first + OSS + you-own-it trust.** Incumbents are structurally cloud-first and won't ship a genuinely local, forgettable, portable memory because it **cannibalizes their own lock-in** — a positioning moat they can't copy without contradicting their business model. *Market it precisely, not over-claimed:* we are local-first and portable, **and** synced memory is readable by the service while processed (§8) — honesty here is itself part of the trust moat.
3. **Embodiment + agent-driving across arbitrary local tools** — a broad integration surface, annoying to replicate.

**Honest correction to the "personal-model moat":** the per-user *model* moat is **weak** (and we ship RAG, not weights, anyway). The defensible moat is **corpus + portability + local-first trust + the relationship the cat builds** — data gravity and trust, not source secrecy. That is exactly why MIT-licensing the client costs us nothing we were relying on.

---

## 10. GUARDRAILS and OPEN FORKS

### Non-negotiables
1. **Never paywall the wedge** — cat, agent-driver, full local memory engine, `PROFILE.md`, local MCP server stay free and MIT.
2. **Transparency + Forget are always free** and never an upsell surface.
3. **No unbounded hosted compute inside the flat fee** — voice, consolidation, personal-model inference, and run-while-away are *all* capped/metered/degrade-to-local. Run-while-away is metered at cost+30% net-of-Stripe, default-off, **transactionally** capped.
4. **Gates are capability-based, never quality throttles** on the local core.
5. **Right-to-forget must provably propagate** to synced vectors *and any derived/consolidated artifact* → RAG (not fine-tuning) **+ derivation-provenance cascade-delete** + crypto-shredding.
6. **Migration never deletes local until server-verified-complete**; never silently drops a fact.
7. **The cat may want, but never withholds or nags.**
8. **Market confidentiality precisely** — encryption-at-rest + access policy, *not* zero-knowledge.

### Resolved conflicts
| Conflict | Tiers | Decision |
|---|---|---|
| Pro price | $8-12 / $20 / $24 / $25 | **$25/mo planning anchor, WTP-validate at $15/$20/$25.** ~55% fleet-blended margin. |
| Personal model | fine-tune (T1) vs RAG (T4) | **RAG at launch** + provenance cascade-delete. |
| Launch voice on Free | Pro-only (T1) vs 30-min free meter (T2) | **Pro-only ongoing; one-time 60s preview for all.** No subsidized usage tier. |
| Trial | 14-day (T1) vs freemium-forever (T3) | **Freemium-forever** + contextual 7-day trial on second-device event. |
| Team tier | defer (T1/T2) vs build-now (T4) | **Defer build to Phase 3; price for it.** Trigger: 3+ asks in 90 days. |
| Hosted-exec allowance | 20 hrs (T1) / cost+30% default-$0 (T2) / provider hard cap (T4) | **No bundled hours; cost+30% net-of-Stripe, default-$0, transactional caps.** |
| Primary conversion driver | personal model (implied) | **Backup + sync + voice; personal model reclassified as retention.** |

### Genuine founder decisions still open (with recommendation)
1. **WTP** — A/B $15/$20/$25 against day-60 activated users before locking price. If COGS-corrected and WTP lands $15–18, **cut COGS, don't defend price.**
2. **Premium-voice vendor quote** — re-quote 2026 premium/clone TTS; set the included allotment (~30–45 min) from the *real* per-minute cost before booking the line.
3. **Required install volume** — confirm ~110k–150k organic installs over 12–18 months is plausible for this audience; if not, raise price or introduce a soft limit pre-launch.
4. **Second-device reach** — measure the % of installs that ever reach device 2; if under ~40%, backup (not sync) is the primary driver and the funnel must say so.
5. **Personal-model quality delta** — instrument offline delta vs base; if weak, don't market it as a Pro pillar.
6. **Cloned-voice biometric compliance** — liveness + BIPA schedule + counsel sign-off before Phase 2.
7. **Cold-storage/lazy-load + compaction scaling** — design so storage doesn't scale with the inactive base; re-derive 12–18-month-tenured COGS.
8. **Annual discount depth** — launch 17%; revisit downward once churn is observed.
9. **EU residency / team DPA** — region hook now; DPA + controller/processor roles before the first EU/team deal.

---

## 11. WHAT CHANGED (and why)

**Launch-BLOCKING (must resolve before the named feature ships):**
- **Transactional refuse-at-limit on hosted execution** (§4, §8.1). v1 asserted "$25 can never go negative" but admitted it didn't know if E2B enforces refuse-at-limit. App- and provider-post-hoc caps fail open under the 10-concurrent/100-starts limits. **Fix:** metering proxy with pre-committed budget reservation per job + cohort circuit breaker + pre-auth hold sized to the cap. *Run-while-away does not ship until this is verified transactional.*
- **Hosted consolidation is capped, not unbounded** (§4). v1 left it as uncapped hosted compute inside the flat fee — a margin liability and farmable LLM proxy. **Fix:** frequency cap + per-run token budget + degrade-to-queue; same provider-layer enforcement as run-while-away. *Margin claim invalid until enforced.*
- **Forget must cascade through consolidated/derived memory** (§8). RAG alone is insufficient because consolidation synthesizes new facts that absorb deleted sources. **Fix:** derivation-provenance graph + cascade-delete/re-derive + disclosed staleness window. *Either prove cascade-delete OR launch with consolidation OFF.*
- **Egress cannot be a static allowlist** for a coding agent (§8). The v1 "registries + our API" control breaks real work or is bypassable via a published malicious package. **Fix:** default-deny per-job egress + DNS/SNI logging + volumetric anomaly detection. *Gates run-while-away.*
- **Funnel survival + required install volume must be sized pre-launch** (§6). v1 called 520 users "modest" while borrowing a paying-customer 12-month retention figure as free-install-to-day-60 survival, never sizing the top-of-funnel. **Fix:** explicit waterfall with stated survival at each stage; back-out ~110k–150k installs at 3% blended conversion. *If implausible, raise price or add a soft limit before launch.*

**Major corrections (not launch-blocking, but the plan is wrong without them):**
- **Margin relabeled and lowered** (§5): 63% was median-user, Stripe-light, support-zero, and ignored the right tail. Fleet-blended planning margin **~55% (support-excluded); ~50–55% loaded.** 63% retained only as the median illustration.
- **Converting cohort is heavier than fleet** (§5): break-even uses converter COGS (~$12–14), so gross profit/converter ~$11–13, pushing break-even to **~640–750 users**, not 520.
- **Voice re-priced** (§5): $0.03/min was commodity STT; real premium/clone TTS is $0.06–0.12/min. Allotment cut to **~30–45 min** pending a vendor re-quote; voice was the single most-underwater line.
- **Personal-model RAG cost split** (§4): not a monthly-refresh cost (fine-tune-shaped); it's per-query retrieval + context tokens + monotonic vector hosting. Now metered per-query + token-budgeted.
- **Corpus-growth COGS modeled** (§1, §5, §8): cost scales with tenure; crypto-shredding + cold-storage/lazy-load + compaction + per-account ceiling are now cost-model-gating, and margin is re-derived for the 12–18-month cohort.
- **Stripe line corrected** (§4, §5): added chargeback/refund reserve; metered run-while-away charges carry their own Stripe fee, so cost+30% is **net-of-Stripe**.
- **Support/ops line added** (§4, §5): ~$1.25/user placeholder; headline is **contribution margin, support-excluded**, with loaded margin stated separately.
- **Conversion planning number** is the **conservative blended 3%** (§6); 4–7% is upside only.
- **Trigger-reach hole fixed** (§6): added **durability/backup as a universal-reach (~100%) loss-aversion trigger** for the single-device majority; sized the limited reach of sync (multi-device only) and personal model (deep tail only).
- **Voice cold-sell fixed** (§3, §6): **one-time 60s premium-voice preview** so every user hears the value before the paywall, without a subsidized usage tier.
- **Personal model reclassified** (§6): retention/expansion feature, not a primary conversion driver; pricing must clear $25 without it (verified §5), with a pre-launch quality-delta kill-criterion.
- **Confused-deputy defense** (§8): least-privilege per-job broker creds + OOB confirmation for state-changing calls + rate limits + denylist covers broker actions.
- **Fraud gate, not "KYC"** (§8): $1 auth is a validity check; added device/ASN/BIN/disposable-email signals, settlement-before-raise, cohort circuit breaker, chargeback in COGS.
- **Source-derived data liability** (§8): secret-scanning on ingest + ToS warranty/indemnity + classification notice + individual-Pro DPA — decided before first dollar.
- **Cloned voice = regulated biometric** (§8): liveness + BIPA retention schedule + Illinois geo-gate + counsel sign-off on no-profit-from-biometrics; gates cloned-voice ship.
- **Backup deletion = crypto-shredding** (§8): immutable-backup carve-out resolved; one mechanism serves GDPR + cost.
- **Confidentiality marketing made precise** (§8, §9): encryption-at-rest + access policy, **not** zero-knowledge; hosted brain reads plaintext in use; user can mark memory local-only.

**Minor:** WTP framed as unvalidated and tied to the price A/B; break-even presented as a range across the usage distribution with fixed infra explicitly separated from variable corpus-scaling COGS.
