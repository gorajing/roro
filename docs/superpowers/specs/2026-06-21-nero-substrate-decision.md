> **HISTORICAL / PARTIALLY SUPERSEDED — see [HANDOFF.md](../../../HANDOFF.md), [PUBLIC.md](../../../PUBLIC.md), and [docs/ROADMAP.md](../../ROADMAP.md).** Memory is now local-first memory2/PGlite, not InsForge; the default brain/embeddings path is local Ollama. The embedding-provenance-stamp and "embedding is the sticky choice" points remain useful background, but the hosted-brain/vendor stack below is not current v0 execution truth.

# Roro Substrate Decision — Lead Architect Final Recommendation (Hardened)

> Output of a 9-agent substrate evaluation (brain / embeddings / memory-host / voice) hardened against 3 adversarial critics. Companion to the v2 spine (`2026-06-21-nero-ultimate-ux-design-PROPOSAL.md`) and the A.5 plan (`../plans/2026-06-21-nero-a5-memory-spine.md`).

## 1. THE HEADLINE

The old v2 spine ruled the substrate stack at the time. Read this as historical substrate reasoning, not as the current build order or provider decision.

There is exactly **one un-retrofittable action**, and it is *not* a vendor swap. It is: **add `embed_model` + `embed_dim` columns to the A.5 `memory` table and stamp them on every write.** Not to enable one shared vector space across tiers (the design forbids that — *re-embed on tier change, never mix vector spaces*) — but to make the *re-embed-on-tier-change* the design mandates **safe and auditable**. Every row A.5 writes without that stamp is a row whose provenance you can never cheaply reconstruct. That is the whole urgency, and it is a couple of columns, not a thesis.

Everything else — Haiku as the hosted brain, one server-hosted Vapi, no speech-to-speech, keep-Insforge-no-PGlite-in-M1 — belongs to the archived spec, not the current local-first v0 path.

## 2. PER-SUBSTRATE TABLE

| Substrate | In-code today | Ruling | Delta | Reversibility | When |
|---|---|---|---|---|---|
| **Brain (decide)** | Nebius DeepSeek-V3.2 | Hosted default = **Haiku 4.5** (already ruled) | Make code match, **but gate the flip on one measured TTFT signal**; keep DeepSeek as fallback | Cheap (env/base-URL behind `BrainProvider`) | **Phase 2** — measure during A.5, flip after |
| **Embeddings** | Qwen3-Embedding-8B @ 1536 | Single model/dim/space; re-embed on tier change, never mix | **ADD `embed_model`/`embed_dim` columns + write-side stamp** | Stamp is additive; the space itself is sticky once rows exist | **In A.5** (the one urgent item) |
| **Memory host** | Insforge (hosted PG+pgvector) | Keep Insforge for M1; no PGlite, no re-embed | None. Keep `pg_dump` exit + RPC SQL as the pre-built Neon escape | Cheap (~200-line adapter + dump) | Leave alone; PGlite is a post-wedge fork |
| **Voice** | Not built (spec-only seam) | Phase D, one `VapiBackend`; no speech-to-speech | Correct the s2s trigger pricing (~10x stale) | N/A (greenfield behind a planned facade) | Don't build before Phase D |

## 3. THE URGENT CALL — Stamp the embedding provenance in A.5

**(a) The model/dim choice is a KEEP, already locked.** `Qwen3-Embedding-8B @ 1536` is fixed; it is #1 MTEB-multilingual (70.58), open-weight, GGUF-available (so it runs local too), Matryoshka-truncated 4096→1536. Nothing to decide. The 1536 width matches OpenAI `text-embedding-3-small`'s native dim, which would avoid an `ALTER` of the `vector(1536)` column on a future fallback — but be precise: a different model is a different *geometry* at any width, so any fallback still requires **re-embedding every row**. Same-width fallback saves the DDL, not the re-embed.

**(b) The net-new, irreversible work is the provenance stamp** (now folded into the A.5 plan):
- **Migration (Task 1):** `add column embed_model text` + `embed_dim int`, plus a backfill stamp of existing rows.
- **Write side (`remember`, Task 3):** add `embed_model` + `embed_dim` to the insert body (from the existing `NEBIUS_EMBEDDING_MODEL` / `EMBEDDING_DIMENSION` consts).
- **Read side:** do NOT add a guard — `assertEmbedding()` already hard-fails on any dimension mismatch. The stored columns' value is **auditability of which model wrote which row**, not runtime dim-checking.
- For M1 keep it minimal: store + stamp on write. Expanding the RPC `RETURNS TABLE` to *return* the stamp is a re-embed-job concern, deferrable.

**(c) Cross-tier "same vector space" is NOT an A.5 goal.** A.5 is single-space on Insforge; there is no second space to corrupt. The OSS local tier, when it ships, re-embeds into its own space — the stamp is what makes that safe.

**(d) Live silent-corruption hazard — FIXED.** `RUN.md` shipped stale env defaults (`NEBIUS_EMBED_MODEL=BAAI/bge-en-icl`, `NEBIUS_MODEL=DeepSeek-R1-0528`, `NEBIUS_VISION_MODEL=Qwen2-VL-72B`) contradicting the code defaults. `bge-en-icl @ 1536` is a different geometry from `Qwen3-Embedding-8B @ 1536`; a dev following RUN.md verbatim would write garbage vectors into the table. **Corrected RUN.md to the code defaults (V3.2 / Qwen2.5-VL-72B / Qwen3-Embedding-8B) on 2026-06-21.**

## 4. THE BRAIN — Haiku as hosted default, gated on a measurement, Phase 2 (not pre-A.5)

Hosted brain = **Claude Haiku 4.5** is the right eventual default (fast TTFT, GA Structured Outputs + strict tool use, a thinking stream). But:
- **It's reversible/cheap** (env + base-URL behind `BrainProvider`), so it does NOT belong on the pre-A.5 irreversible lane. A.5 runs fine on incumbent DeepSeek-V3.2.
- **Gate the flip on a MEASUREMENT, not a vendor benchmark.** Instrument `decide()` parse-failure rate + p50/p95 of the **first `content` delta (narration start)** during A.5. The cited "DeepSeek 2.13s" is provider-specific (Nebius-Fast serving); the same model is ~0.9–1.3s on DeepInfra/Friendli/Eigen — a *cheaper same-model provider swap* is the first lever before a vendor move.
- **Budget the UI ripple:** swapping the brain means updating the hardcoded "DeepSeek (Nebius) is reasoning…/planning…" captions and verifying Haiku's thinking-stream delta maps to `onReasoning` → `setState('thinking')`. Pay this inside the C1 `status`-kind migration that already touches these sites.
- **Fix `preflight()`** (it throws on boot if the reason id is absent from the *Nebius* catalog) before moving the reason model to Anthropic.
- **Only `decide()` moves.** Keep the thin fact-extractor and `describeScreen` (vision) on cheap Nebius; never fold a vision/embedding swap into the brain swap.
- Local/BYO tier: Ollama with `format`-schema constrained decoding (Qwen3.x, temp 0). Keep `parseDecision`/`extractJsonObject` on **portability** grounds.

## 5. THE HOST — Keep Insforge for M1

All access is behind `insforgeFetch()` + three PostgREST RPCs over open-source Postgres+pgvector; `pg_dump` exits and the RPC SQL replays on Neon/Supabase/self-host (~200-line adapter + dump/restore, **not** a re-embed). At Roro's scale recall is brute-force cosine — no ANN forcing-function. Insforge is a vendor-maturity liability *in the abstract* (public launch Nov 2025, ~5k stars) but **contained by the thin adapter**; **Neon is the pre-built later target**. Two corrections to defer-PGlite framing: PGlite has a named durability spike (single-writer WASM, WAL-corruption-on-force-quit, a macOS 26 init crash) that must run before committing; and "free→Pro is a `pg_dump` import" is wrong — because local≠hosted geometry, **free→Pro is a re-embed** (the stamp makes it correct). Keep a scheduled `pg_dump` + the RPC SQL in `db/migrations/` as cheap insurance.

## 6. VOICE — Deferred to the dedicated voice pass

The substrate eval defers voice to the dedicated voice-first-class evaluation. The one factual correction it made: the OpenAI speech-to-speech escape trigger is **`gpt-realtime-2`** (not `gpt-realtime`) at **~$0.18–0.46/min uncached (~$0.05–0.10 cached)** — ~10x the stale ~$0.04/min figure, making the real gap vs self-host (~$0.005–0.01/min) **~20–90x, not ~4–8x**. *(Note: voice is being re-opened as first-class in a separate pass per the founder; see that decision when it lands.)*

## 7. WHAT TO DO NOW vs LEAVE ALONE

**DO IN / DURING A.5 (net-new only):**
1. **Add `embed_model` + `embed_dim` columns + write-side stamp** (the one irreversible item — done in the plan).
2. **Fix `RUN.md` env defaults** — done.
3. **Verify the live Insforge schema before applying Task 1** (the `match_memory` signature + `vector(1536)`).
4. **Instrument** `decide()` parse-failure rate + p50/p95 first-content-delta (gates the future brain flip — must exist before any swap).
5. **Keep graceful degradation a LOGGED-hard-failure veneer, not catch-and-swallow.** The cat's "my memory's fuzzy" line is a narration-layer fallback only; the turn must still record that recall failed. Never wrap `recall()` in a soft `try/catch → empty`.

**LEAVE ALONE (behind a seam — swap on a named trigger):** brain default (Phase 2, gated on #4); vision + recall-embed path; Insforge host (Neon pre-built); PGlite (post-wedge, gated on the durability spike); voice/Vapi (Phase D); executor runtime; Redis "plumbing".

**Reopen triggers:** Brain → measured Haiku p50 narration-start >~1.2s on real turns, or a sub-0.5s structured-output model passing the decide fixtures, or an open-hosted-tier requirement. Embeddings → only on evidence (recall becomes the bottleneck, or Nebius EOLs Qwen3-Embedding → OpenAI 3-small@1536, still a funded re-embed). Host → an Insforge incident/SLA miss → execute the pre-built Neon swap.

## 8. The discipline

Almost everything sits behind a seam, so almost everything is "leave alone — swap-later is cheap by construction." The single asymmetry that sets sequencing: **every cheap substrate stays cheap after the corpus exists — except the embedding vector space, which gets costlier per row.** That asymmetry, and only that one, justifies pre-A.5 urgency.
