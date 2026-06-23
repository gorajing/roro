# WS5 — Cosmetics willingness-to-pay validation plan

> **This is a validation plan, not a build plan.** HANDOFF §7 gates the cosmetics store
> behind one open question: *will **developers** pay for pet cosmetics?* (proven for
> gamers/consumers, unproven for devs). This document specifies a **cheap experiment** to
> answer that **before** any store/payments/equip/palette-swap engineering. Building the
> store is explicitly **out of scope** until this passes.

## Why validate first (not build first)

- The bond (built by free memory) is the engagement engine; cosmetics are the revenue.
  The wedge is never paywalled, so the store is a **bet on revealed dev spend**, not a
  prerequisite for the product working.
- Cosmetics are ~$0 marginal cost (content, not compute), so *any* real conversion is
  margin — but the store + payments + equip + renderer palette-swap is real engineering.
  Spending it before evidence is the expensive mistake.
- Pattern: products with an **unknown spec** discover product-market fit through cheap
  iteration, not by building the full thing first. A fake-door test is the cheapest
  iteration that produces a real signal.

## Hypothesis (falsifiable)

> Among **activated** developer users (used Roro for ≥3 sessions across ≥2 calendar days),
> **≥5%** will express purchase intent for an alternate `-ro` pet at a **$4.99** price
> point (click a "Get this pet" CTA), and **≥2%** will leave a notify-me email — within a
> **2-week** measurement window or the first **150 activated users**, whichever comes first.

If intent clears these bars, dev willingness-to-pay is plausible enough to build the store.
If it doesn't, it isn't — and we've spent days, not weeks.

## Mechanism: an in-app fake door (smoke test)

The smallest viable experiment that measures *revealed* (not stated) interest, in-context:

1. **Cosmetics peek (fake door).** A new "Wardrobe / Shop" entry shows the existing `-ro`
   roster (`src/shared/pets.ts`: Miro, Sero, Taro) + a couple of item concepts, each with a
   visible price (`$4.99` pet, `$1.99` item). The art is just the procedural palette swatches
   we already have — no new assets.
2. **Intent capture.** "Get Miro — $4.99" opens a modal: *"Coming soon. Want it?"* with
   **[Notify me]** (optional email) and a dismiss. No checkout, no payment SDK.
3. **Instrumentation (local-first, anonymous).** Log intent events to the existing
   owner-scoped store as a new non-fact `kind` (e.g. `cosmetic_intent`) — `{ pet/item,
   priceShown, action: 'view' | 'cta_click' | 'notify', ts }`. **No PII** beyond an
   optional email the user volunteers; owner-scoped + local, consistent with the
   privacy/local-first laws. A tiny query (or `npm run` script) computes the funnel:
   peek-views → CTA-clicks → notify-intents, over activated users.

### Why this mechanism (vs. alternatives)

| Option | Cost | Signal | Verdict |
|---|---|---|---|
| **In-app fake door (chosen)** | ~2–3 days | Revealed, in-context, per-price | **Primary** |
| Landing page + waitlist | ~3–4 days | Out-of-context (not while using Roro) | Secondary, if reach is too low in-app |
| One real paid variant (Stripe) | ~1 week + store risk | Strongest, but that's most of the store we're trying to gate | Rejected for v1 |
| Survey ("would you pay?") | ~1 day | Stated, not revealed — weak | Rejected (intent ≠ behavior) |

## Success criteria & decision gate

- **PASS** (both bars met): green-light the store build — payments, equip/persistence, and
  the renderer palette-swap feed (the deferred §8.5 work).
- **AMBIGUOUS** (CTA clicks present but below bar, or one bar met): run a **price A/B**
  ($2.99 / $4.99 / $7.99) for one more window before deciding — don't build yet.
- **FAIL** (CTA-click rate ≪ 5%): do **not** build the store. Revisit the monetization
  thesis (e.g. items/voice-packs vs. pets, or a different audience cut).

Pre-committing these thresholds avoids post-hoc rationalization of a weak result.

## Effort budget & explicitly out of scope

- **Budget:** cheap — days, not weeks. Fake-door UI + intent logging + a funnel query.
- **OUT of scope until PASS:** any payments/Stripe integration, real entitlement/equip,
  cosmetic persistence, the avatar palette-swap renderer feed, and the creator/UGC
  marketplace. The fake door deliberately stops at *intent*.

## Risks & mitigations

- **Low in-app reach** (few activated users yet) → the 2-week / 150-user cap may not be hit;
  mitigate by also standing up the landing-page waitlist (secondary option) to widen reach.
- **Novelty click-through** (people click out of curiosity, not intent) → the notify-me /
  email step is the stronger bar; weight it over raw CTA clicks.
- **Measuring the wrong users** (non-developers) → scope to activated devs (≥3 sessions);
  the audience is organic-pull developers by design.
- **Plan written but never executed** → this is an org risk, not a build risk; track the
  experiment as the next cosmetics task with an owner + a window.

## Next step

Implement the fake door + intent logging (a small, isolated PR), run the window, compute
the funnel, then apply the decision gate above. Only a PASS unlocks store engineering.
