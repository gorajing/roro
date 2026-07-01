# Extending roro beyond the codebase — the casual-user opportunity, honestly

## 1. The honest verdict

**One roro. One primitive. One local brain. Expand the SPINE along app-complexity-and-repetition — never along user-sophistication-downward. Tier the retention *accounting*, not the product.** That skeleton survives both critiques and it ships.

But the load-bearing firewall in the draft was mis-specified, and fixing it changes the answer. The draft said: keep casual value in the RECALL lane (replay the user's own verified resolution), never the GENERATION lane. That leaks. **Recall presupposes a *first* resolution that was verified.** For a coder the verifier is free and automatic — the code ran, the test passed, the resolution self-certifies, and the user can detect a stale replay. For a colorist's "warm look," a RevOps filter, or a parsed sentence, *nothing* verifies the first resolution. Without a cheap auto-verifier, "recall" is just **replay of an unverified first guess, re-served with the false authority of "you did this before"** — the exact 3B error the draft claims to fence off, now frozen.

So the real firewall is **VERIFIABILITY**, on two axes:
1. Is there an automatic, near-free ground-truth signal that the stored resolution actually *worked*?
2. Can THIS user catch a stale or wrong replay?

Auto-verifiability is a *coder property*. Every casual segment must be re-gated on it, and "expand only where verifiability compounds" replaces "expand only where repetition compounds." Repetition without verifiability is a liability that compounds, not a moat.

**The stance on focus-vs-breadth:** Do not extend to "casual users" as a class — that dissolves the moat into a race against cloud incumbents on open-domain breadth over a stranger's screen, the one axis a local 3B/7B is guaranteed to lose. Do not stay purely coder-pure either — that forfeits real adjacent verticals (creative/prosumer power tools) where verifiability *does* hold and a genuine daily anchor exists. The honest shape is a **hard-fenced single product**: admit the pointing BODY to the mainstream as latent capability, but build the SPINE only for repeat-users of durable, complex, *verifiable* apps.

## 2. The casual wedge — the ONE moment

**Not the first answer. The RETURN — and only where the return is verifiable.**

Pointing-and-grounding-in-place ("drop the cat, say 'this,' get a plain-language answer landed on the exact pixel, on MY screen, no tab-switch") is the acquisition *demo*, but it is a commodity Apple, MS Copilot Vision, and Google already ship on-device. It is not the wedge.

The wedge is the **second time you hit the same friction in the same complex app**: roro pads over and points at the click-path YOU used last time, before you ask again. The stored object is identical across a coder's diff, a colorist's Qualifier node, and a RevOps user's Salesforce filter: `{screen-anchor + captured friction + the user's own resolution}`. It is the one thing OS pointing cannot copy, because it requires compounding private local memory of THIS user's history.

**Two honest constraints the draft skipped, from the critiques:**

- **Re-recognition, not just storage.** The primitive is uniform to *store* but hard to *re-recognize*. "This is the situation you solved before" requires matching a new screen to a stored resolution. For code the anchor is stable and textual (a symbol, an error string) — locally tractable. For a node graph or a dashboard, the same friction recurs on a *visually different* screen (different clip, different data) — a hard visual-similarity task, the VL model's weakest. **The wedge is easiest exactly where retention already exists (coders) and hardest everywhere you expand.** This is a real tax on casual expansion, not a footnote.

- **The cold-start window is unavoidably the generation lane.** Every retained user must survive the first N encounters *before* memory compounds — and during that window there is nothing to recall, so roro must generate on a small brain. For coders that's fine (verifiable, error-detectable). For casual users this front-loads the trust-torching case onto the users least able to catch it. **The wedge only earns retention if the segment survives cold-start** — which is another reason to gate on verifiability and to make step-2 a segment where the user *can* catch a bad first answer.

## 3. Who — segments ranked by REAL fit (verifiability × daily-anchor × acquirability)

The draft ranked on retention-shape alone. Re-scored on **verifiability** (Critic 1) and **acquirability/distribution** (Critic 2), the ranking changes. Two segments swap effective priority.

**1. Creative / prosumer pros in a dense daily tool** — DaVinci Resolve, Ableton, Premiere, Blender, heavy Excel. *Maya the editor, not the occasional Canva user.* **[Strongest overall fit — the recommended step-2 beachhead.]**
- JTBD: "navigate this vast tool I live in every day; replay my own control-sequence recipes ('do my warm look') without re-hunting menus."
- Verifiable: **for deterministic navigation only** — the control exists or it doesn't; the recipe reproduces or it doesn't. The user, being an expert, catches a bad replay instantly.
- Daily anchor: genuine (in the tool every working day → restraint stays safely dialed up).
- **Distribution (the axis the draft never scored):** clusters in reachable, visible communities (r/editors, r/ableton, DaVinci/Blender forums, the YouTube tutorial ecosystem), and produces a **legible shareable artifact** ("watch roro replay my warm-look recipe"). Jin can dogfood via his music/video KB. This is the one casual segment that extends the moat AND the funnel at once.
- Hard fence: navigation + the user's OWN recipes only. The brain is good at UI-grounding, bad at taste ("make it cinematic") — and a taste-user detects bad taste instantly. Any drift into generative craft advice torches trust. A MODE, never a product.

**2. Persistent reading/parsing-barrier accessibility slice** — dyslexia, non-native readers, cognitive-load, mild low vision. *Marcus, not blind users, not one-off help.* **[Strongest RETENTION story; distribution-dead early → serve LATER, not first.]**
- JTBD: "read/simplify/land-on-the-pixel the text and UI I struggle with, dozens of times a day, across every app."
- Retention is structurally the best of any casual segment: the barrier is a *persistent condition*, the trigger fires constantly, and memory reschemas into a compounding **accommodation profile** (your pace, first language, the words you stumble on).
- **But two honest downgrades from the critiques:** (a) *Verifiability is the worst of any segment.* "Read verbatim, ~zero hallucination" is **false for a local VL model** — OCR/VL over rendered fonts, low contrast, and non-Latin scripts is exactly where small models silently substitute plausible-wrong tokens (a dropped negation; `$1,300`→`$1,800`), and the disability *is* the inability to independently verify the read. No auto-verifier AND a user structurally unable to catch the error = the highest-stakes lane, not the safest. (b) *Distribution is the worst:* no concentrated reachable channel, privacy reasons NOT to self-identify, low jank tolerance, and no shareable artifact (you can't screenshot "roro helped me read this" without exposing the disability).
- Also: the accommodation profile is a memory of *the user*, not the `{anchor+friction+resolution}` primitive — a small trenchcoat seam to watch.
- Verdict: the best *soul* story and the worst *early wedge*. Serve it, dignify it, brand it "a reading and pointing companion" (never "assistive tech for the disabled"), hard-rail against interpreting high-stakes documents — but **not as beachhead-2**. It needs the VL reliability and distribution maturity that only come after the coder and creative loops are proven.

**3. Permanent advanced-beginner in a daily-work tool** — Excel, the CRM, the SaaS she runs every day. *Priya.* **[Partial — strong only for the daily-anchor subset.]**
- JTBD: "point past my vocabulary gap in the one tool I use daily and keep hitting new walls in."
- On-soul (body + local skill-map; refuse curriculum/content/gamification). Verifiable where the tool gives feedback; the daily anchor is real. Retention is genuine but lumpy (new-gap events). The greedy "learn ANY app" mass pitch is the trap — it demands a cloud brain, a content library, and streaks, all of which dissolve roro.

**4. Overwhelmed knowledge workers in SaaS sprawl** — RevOps across 8 tools. *Dana.* **[Partial — thin retention, high restraint-betrayal pressure.]**
- App-agnostic pointing is worth MORE to her than to a coder (8 apps, not one editor), and POINT-DON'T-ACT is a real feature for someone petrified of corrupting production Salesforce. Spine repurposes to org-specific tacit config ("how OUR tools are set up") — a real private moat, just shallower.
- Honest risks: the VL ceiling bites hardest on dense small-font dashboards ("what is this telling me" is generation, not recall, and often unverifiable); her weak anchor creates the strongest pressure to bolt on needy mechanics. Serve as the SAME roro with repurposed org-memory; accept thin retention; cap the "interpret my data" promise; add zero engagement hooks.

**5. Long-project writers/researchers** — building one artifact over weeks. *Maya the PhD, not the deadline student.* **[Partial — real retention, different physics.]**
- Anchor is a persistent *artifact-in-progress* plus its ephemeral source corpus (tabs that die), so the spine earns MORE per session even at lower frequency. Stay a pointer-and-memory-keeper. Traps: "second brain / index all my notes" (the killed whole-life scope) and the SYNTHESIS fantasy ("summarize these 5 papers") — for a researcher, confidently-wrong synthesis is worse than silence and is *unverifiable* by definition.

**Honest weak-fit calls (acquisition-only or decline):**

- **AI-curious mainstream** (*Diane, frozen at the blank chatbox*) — **weak retention / strongest acquisition demo.** Pointing replaces prompt-craft; local-first is the sharpest differentiator. But value *decays as she learns* (retention inversion), invocations are sporadic and aversive, and cold-start puts unverifiable generation in front of the user least able to catch it. Best on-ramp roro has; convert the subset who reveal a daily anchor; do not build FOR the rest.
- **Everyday-life admin / jargon-decoder** (*Maria on tax/health portals*) — **bonus only.** Episodic, disjoint (every form is a different form → no compounding spine), no anchor, and the highest gravity toward liable general-life advice on a brain confidently wrong on real-money/legal stakes. Bounded explain-don't-advise MODE for already-anchored users, never standalone.
- **Non-technical seniors / confused parent** (*Marilyn*) — **decline as a build target.** Success is self-erasing (fewer confusions → fewer summons), the nearest anchor is her son's relief (not her habit), and serving her well *requires* breaking POINT-DON'T-ACT (she wants "just do it") and LOCAL-FIRST (her real job is scam/safety judgment — open-world, adversarial, #1 fraud-target population, where a local 3B drawing a reassuring arrow at a phishing button is a fraud vector wearing a pet).

## 4. The unifying architecture

**One roro, genuinely — not two products in a trenchcoat — because every segment emits the identical primitive:** `{screen-anchor + captured friction + the user's own resolution}`, whether the anchor is a diff-line, a Settings toggle, or a Qualifier node.

**SHARED CORE (never forked):** the See-and-Point body (universal I/O), local VL grounding, voice, and the anchored-friction-resolution memory ENGINE.

**DIVERGENT DEPTH via pluggable schema on the SAME engine:** semantic compounding code-reading for editors; procedural screen-path replay for creative/prosumer apps; org-config tacit knowledge for SaaS generalists; argument-in-progress corpus for researchers; (later, guarded) accommodation profile for reading-barrier users. That is a MODE — different content in one mechanism — never a separate binary.

**The competence cap is dissolved by the VERIFIABILITY firewall, not by a recall-vs-generation label:** keep casual value where a stored resolution *self-certified* and the user *can catch a bad replay*. Where neither holds, roro stays a pointer and memory-keeper, not an answerer.

**Every casual mode must ship an explicit VERIFIER SPEC — the artifact the draft asserted six times and defined zero.** For each mode, name: what signals the first resolution worked, and how the user catches a stale replay. Concretely — code: test/run exit status. Creative navigation: did the control-sequence reproduce the deterministic result (recorded, replayable, expert-checkable). SaaS org-config: did the documented click-path still land on the same end-state. **If a mode cannot name a cheap auto-verifier, it does not get a compounding spine — it gets the pointer body only.** No verifier spec, no memory schema. This is the structural rule that keeps "one product" from leaking.

**Three hard lines — crossing any one means you've built a different product wearing the cat:** (1) NO separate casual cloud brain; (2) NO separate casual data model; (3) NO engagement/streak mechanics to compensate for low casual frequency.

## 5. The retention problem, solved honestly

**Relocate the anchor** — from a daily-opened APP to the **moment of friction itself**. roro is summoned on being-stuck and silent otherwise: MORE restraint-native (break-glass), not less, so no engagement lever is needed. This produces real, roro-shaped retention only where friction *recurs verifiably*: the daily-tool creative pro, the daily-work advanced-beginner, (later) the reading-barrier user. For the episodic segments — seniors, life-admin, deadline students, one-off onboarding, AI-curious mainstream — the anchor genuinely does not form, and they churn like every stakes-free pet. **Accept that churn.** Scope those as acquisition/break-glass, never retention.

**A numeric anchor bar (Critic 1's missing threshold), so no segment can be rhetorically argued into "retention":** a segment counts as *anchored* only if the median retained user hits the recurring, verifiable friction **≥3 sessions/week over an 8-week window** with **measurable compounding-memory reuse** (recalls that fire before the user asks). Below that bar → acquisition tier, full stop. Without a number, the trenchcoat re-forms every time growth stalls.

**Two structural enforcement mechanisms (Critic 1 + Critic 2), because "hold the line by discipline" is a strategy with no wall:**
1. **Do not instrument acquisition-segment retention at all.** Gate the roadmap on a *single retained-cohort metric that episodic churn literally cannot move.* If you ship 10x more episodic users than retained ones, your dashboard, app-store reviews, and support queue will otherwise be dominated by the segment you swore not to build for — and leadership will read thin casual churn as a *mandate to make roro needy.* That mandate is the litmus that you've left the anchor domain.
2. **Reconcile measurement with no-telemetry (the contradiction the draft never named):** roro is local-first with no telemetry, so you *cannot* observe retention, share-rate, or anchor-conversion on the fleet, and you *cannot* notify the convertible subset without breaking restraint. Resolution: measure only via **opt-in local metrics, voluntary "share your streak-free stat," and named design-partner cohorts.** The retained-cohort metric lives in the design-partner panel, not a global funnel. "Convert the subset who reveal a daily anchor" happens through *product surface the user chooses to reveal*, never a phone-home flag or a nudge.

**The pet/attachment layer solves itself:** it scales with frequency automatically — rich individuation for daily anchored users, a graceful no-op utility (no companion pretense) for sporadic ones. roro must NEVER reach for notifications, streaks, decay, guilt, or "haven't seen you in a while" to paper over thin casual retention. That mechanic is the tell.

## 6. Moat — extend or dissolve

**Both — it depends entirely on the axis of expansion, and now on verifiability.**

Breadth **EXTENDS** the moat when it follows app-complexity-and-repetition **AND verifiability**: creative power-tools and daily-work verticals deepen the compounding private LOCAL memory no one can copy, each shipping its own verifier so recall stays honest. Breadth **DISSOLVES** the moat when it follows user-sophistication-downward: episodic, heterogeneous, *unverifiable*, non-anchored users generate no recurring memory (zero spine), leaving roro fighting cloud incumbents on raw model breadth over a stranger's screen — the one axis a local 3B/7B is guaranteed to lose.

**The incumbent-durability argument the draft owed (Critic 1).** "Compounding local memory no one can copy" is only a moat if the incumbent is *structurally* unable, not merely currently-not-doing-it. Apple Recall already has OS-level screen history; MS Copilot Vision has the stream *and* on-device models. Why can't they add second-encounter replay next cycle? The honest, durable answer is **not the screen stream** (they have it) — it is the **per-domain verifier + the user's owned resolution corpus.** An OS vendor can replay "what was on your screen." It cannot cheaply know *which resolution actually worked for you and how you verified it* across a long tail of professional tools, because that requires domain-specific ground-truth loops (test runners, deterministic control-sequences, expert-checkable recipes) and a trust posture (local-only, no-telemetry, owner-scoped, POINT-DON'T-ACT) that a horizontal platform monetizing attention cannot credibly adopt. **The moat is the verified-resolution corpus + the restraint posture, not the pixels.** Wherever verification is cheap and generic, the OS wins and roro is just a worse OS feature — which is precisely the simple/infrequent casual user, who must be refused as a build target.

Net: casual expansion is a moat-extender **if and only if** it is disciplined to *verifiable* repeat-users of durable complex apps and refuses the four dissolving temptations (cloud brain, content/curriculum, gamification, open-domain Q&A).

## 7. Sequence & GTM

**Coding-first → ONE adjacent power-vertical → later breadth. Casual pointing is a latent capability you leave switched on, not a funnel you spend attention on.**

The draft's "parallel casual acquisition from day one, near-zero net-new cost" is mispriced (Critic 2). Code reuse is near-free in *engineering*; it is expensive in *positioning*, the scarce pre-PMF resource. Dual messaging ("a coding companion" AND "point at anything") actively damages the dev wedge — developers distrust tools that also pitch to grandma. **Positioning attention is zero-sum even when code isn't.**

**The distribution reality (Critic 2), which the draft dodged entirely:** roro is local-first, no-telemetry, no shareable URL, no server-seeded graph, no network effect. A casual user who installs, gets one answer, and churns leaves **zero trace** — no referral, no artifact, no data. So "acquisition-only casual segment" is nearly a null category *unless it produces a shareable artifact and clusters in a reachable channel.* The only named growth loop is the **pet-points-at-a-thing GIF** — and it only spins in a segment that (a) lives where the GIF spreads, (b) evangelizes $0/offline/local as a *value* not a confusion, and (c) installs niche desktop tools without friction. **That segment is developers, and after them, creative pros — nobody else.**

**Sequence:**
1. **Win the coder beachhead.** The extreme case that proves the primitive, the compounding spine, and the *only* segment where the local-first GIF loop natively functions. **Unlock gate (Critic 2's missing trigger gate):** do not open any adjacent vertical until coding is *measurably won* — e.g. **N retained daily coders at ≥8-week compounding-memory retention above the §5 anchor bar, plus organic install rate ≥ X, with the GIF loop demonstrably spinning on its own.** Without this trigger, "coding-first then expand" degrades into "do both now" the first time growth stalls.
2. **Then exactly ONE step-2 pick: creative/prosumer pros.** Not two segments — bundling reading-barrier + creative (as the draft did) re-imports the trenchcoat through the GTM door: they share "recall-safe daily anchor" and *nothing else* that matters (different channels, buyers, trust bars, evangelists). Creative wins on *both* axes: it clusters in visible communities (r/editors, r/ableton, Blender/DaVinci forums, the tutorial ecosystem), produces the shareable artifact ("roro replayed my recipe"), survives the verifiability firewall for deterministic navigation, and Jin can dogfood it. It extends the moat AND the funnel at once.
3. **Then, later, reading-barrier** — strongest retention, but distribution-dead and VL-reliability-dependent, so it needs the maturity that only steps 1–2 produce.
4. **Let AI-curious mainstream, life-admin, and SaaS generalists in as acquisition-only**, convert the subset who *reveal* a daily anchor (via chosen product surface, not notification), and refuse to build FOR the rest.

**Per-candidate gate for every future expansion:** *"Does this user perform a repeated, VERIFIABLE workflow in a daily-anchor app, on a channel that produces a shareable artifact, where a local model can be corrected?"* Expand only on YES to all four.

## 8. What roro must NOT become

Four betrayals, each of which forks roro into a different product wearing the cat:

1. **A caregiver / tech-support tool for the confused senior** — requires breaking POINT-DON'T-ACT into point-AND-do, and breaking LOCAL-FIRST to attempt open-world scam/safety judgment, where a local 3B drawing a reassuring arrow at a phishing button is a fraud vector, not a feature.
2. **A screen-tutor SaaS with a cat skin** — a curriculum/content library plus gamified streaks bolted on to fight the graduation-churn of casual learners. That is clicky with fur, and the streaks directly detonate stakes-without-threat.
3. **A general-life advisor** that tells a scared user which insurance box to pick or computes their tax liability — one confident wrong answer to a trusting non-coder who *can't detect the error* is a trust-death event, and it re-enters the already-killed whole-life super-assistant through the friendliest door.
4. **The deepest one — a NEEDY roro** that manufactures return visits with nudges, streaks, decay, or guilt to compensate for honestly-thin casual retention.

**The two tells that you have left the anchor domain and are betraying the soul:** (a) a mode gets a compounding memory schema *without a named cheap verifier* — you are now freezing and re-serving unverified guesses; (b) any separate casual cloud brain, separate data schema, or engagement mechanic. **The rule: serve casual users without building FOR them, and without marketing TO them until the beachhead's GIF loop is proven to spin on its own — and refuse, permanently and in writing, alongside the killed whole-life-context scope, the simple-novice, one-off-task, transient-onboarding, and open-domain-generation segments.** The discipline is not a hope; it is the verifier spec, the anchor-bar number, and the un-instrumented acquisition tier — the three structural walls that make it the product.

---

> **Provenance.** Generated by the `roro-casual-users-expansion` multi-agent workflow (8 personas + 2 strategic lenses → synthesizer → moat + GTM critics → integrator) during a Claude Code session, then reconciled against adversarial critics. It is a thinking artifact / north star, not a spec. Zuhn KB was not reachable that session, so it is grounded in roro's own invariants.
