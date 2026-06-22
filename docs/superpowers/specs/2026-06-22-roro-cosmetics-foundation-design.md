# Roro Cosmetics — Foundation + Status

> **Status:** the **catalog foundation is built** (the `-ro` pet-variant registry). The **store /
> payments / creator marketplace are deliberately NOT built** — HANDOFF §7's one real open risk is
> *"will developers pay for pet cosmetics?"*, with the explicit instruction to **validate cheaply
> before building the whole store.** This phase respects that: free foundation now, store after
> validation.

## The model (locked, §7)
- Monetize the **bond** (built by free memory) via **cosmetics** = **buy-once assets that run
  locally** (alternate pets, items, voice packs, a cloned voice) — never metered cloud. ~$0 marginal
  cost; sidesteps the privacy/abuse problems of paid hosted compute; memory stays 100% free.
- The **`-ro` roster is the catalog spine**: **Roro** (flagship/default) · **Miro, Sero, Taro**
  (first collectibles, the founder's real pets — authentic origin + cosmetic cold-start fix). A new
  character just needs a `-ro` name.

## What's built now (free, tested)
- **`src/shared/pets.ts`** (5 tests) — `PetVariant` (id = `-ro` name, palette driving the procedural
  PixiJS cat, single default) + the roster + `getPet`/`defaultPet`/`resolvePet`/`isRoName`. Pure data
  + lookups; the foundation the cosmetic system sits on.

## Deferred (in order)
1. **Avatar palette-swap** — feed `PetVariant.palette` into the procedural cat (`renderer/character/*`)
   so selecting a variant re-skins the cat. The pure seam exists; this is the renderer integration.
2. **Equip/persistence** — the active variant in `userData` (owner-scoped), like `owner.json`.
3. **VALIDATION GATE** — *cheaply* test willingness-to-pay (a "coming soon" / pre-order / a single
   paid variant) BEFORE building the store. This is the one real risk; don't skip it.
4. **Store** — buy-once variants/items/voice-packs (only after #3 validates).
5. **Creator marketplace** — community pets/items/voice packs, rev-share (the scalable version).

## Why stop at the foundation
Building a full store on an unvalidated premise is exactly what §7 warns against. The roster +
variant seam is real, free, and useful (it makes the cat customizable and seeds the catalog), without
betting engineering on an unproven "devs pay for cosmetics" assumption.
