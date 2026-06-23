# Roro — Long-term Memory Foundation (build-it-right, pre-launch)

Decision context: we can rebuild before launch and want the *foundationally correct* memory substrate, not a patch. Memory is THE moat (per-user, lifelong). Grounded in the research synthesis (MEMORY-RESEARCH.md) + your own proven systems (zuun, Zuhn).

## Requirements that make Roro's memory specific
- **Lifelong, single-user, per-user moat:** must accumulate YEARS of one user's history, stay fast, and compound into "knows-you." Not multi-tenant; no aggregate network effect.
- **Local-first + user owns the data:** privacy is the moat; the user should be able to read/back-up/move/git their own memory. $0-idle.
- **Coding companion:** durable prefs (facts), per-repo project context, episodic work history, and the relationship/persona.
- **Fixed local brain (RAG-not-fine-tuning):** intelligence = better retrieved context; "forget" = delete data.

## The reframing insight: make the irreversible reversible
HANDOFF calls the embedder "the one irreversible choice" (re-embedding a corpus is a migration). **A files-as-source-of-truth design dissolves that:** if every memory is a durable file and the DB (vectors + FTS + indexes) is a *rebuildable cache*, then changing the embedder, the schema, or even the DB engine becomes a **reindex from disk — zero data loss**. For a lifelong personal corpus this is the single highest-leverage foundational choice: it de-risks *every other* sticky choice. zuun already runs exactly this (write markdown → derive PGlite index).

## Foundational choice 1 — Dual store: files = source of truth, DB = derived index
- **System of record:** one file per memory under the owner's data dir (Markdown + YAML frontmatter, like zuun, or JSONL — TBD), human-readable, git-able, grep-able, atomic write (tmp+rename).
- **Derived index:** PGlite holds `entries` (mirror) + `entries_vec` (pgvector) + `entries_fts` (full-text). Rebuildable from files via `reindex`. Vectors stamped with `embed_model`/`embed_dim` (already a principle) so a model change = reindex.
- **Write path:** file first (durable), then index transactionally; on mismatch, reindex wins from files.
- **Why:** ownership + durability + reversibility. Cost: dual-write discipline (proven manageable in zuun). This is the build-it-right call for a lifelong corpus.
- *Open:* Markdown+frontmatter (zuun, human-first) vs JSONL (append-cheap, machine-first). Lean Markdown for owner-readability (it's the user's memory).

## Foundational choice 2 — Tiered memory (not one flat table)
Different lifecycles + access patterns → distinct tiers, schema designed for the moat features from day 1:
- **Core block** (always in prompt): a small pinned owner/persona block {label, description, value, limit} (MemGPT/Letta). The "knows-you" essence; supersede-not-overwrite.
- **Facts** (durable semantic): typed `key→value` + **confidence + last_accessed + shelf_life/ttl + importance + provenance** (Zuhn's fields), supersede-not-overwrite, ADD/UPDATE/DELETE/NOOP (mem0).
- **Episodes** (append-only log): turn history; hybrid-retrieved + recency.
- **Working set** (current session): last N turns, pure recency (`seq DESC`).
- *(Designed-for-later)* **relationships/graph** edges between facts/entities (Zep/Graphiti) — schema leaves room; not built v1.
- **Why design all fields now:** so consolidation/forgetting/confidence land *without another migration* — and with files-as-truth, even a schema change is just a reindex.

## Foundational choice 3 — Hybrid retrieval (port zuun) + working/long-term split
Per MEMORY-RESEARCH.md: blended `relevance(cosine) + recency(decay over last-access) + importance`, min-max normalized, top-k 3-5, **+ lexical (FTS/RRF)** for identifier queries; **temporal/meta → pure recency** over the working set (bypass vectors); **drop the 0.3 floor** to a never-zero fallback; per-component **explainability** persisted for tracing/evals.

## Foundational choice 4 — Embedding, now reversible
Choose the best *local* embedder for the use case (nomic-embed-text is the current default; evaluate bge-m3 / Qwen3-embedding for quality), but it's **no longer a lock-in** — files-as-truth means re-embedding is a reindex. Keep the provenance stamp. Decision can even be deferred / A/B'd.

## Foundational choice 5 — Consolidation + confidence (Zuhn model, zuun caution)
Off-response-path ("sleep-time") pass that distills recent **episodes → durable facts** (quality-gated), with **confidence + decay + empirical-outcome updating** (Zuhn). Never auto-distill episodes into the recall corpus (zuun's anti-pollution rule). Fields exist from day 1; the pass lands incrementally.

## Foundational choice 6 — Forgetting (designed-in)
TTL by category (facts≈∞, transient context short), access-frequency reinforcement (boost on hit), quality-gated writes (skip non-novel/contradictory). Fields (`last_accessed`, `ttl_category`, `importance`) exist from day 1; pruning lands later.

## Foundational choice 7 — Tracing/evals seam (designed-in)
One-way observation tap at each seam (retrieve/form/consolidate/forget), persisting per-component scores (zuun's `parts`) + formation decisions + consolidation lineage to a local `RORO_TRACE=1` sink; correlated by `runId` + memory-row `id`. Substrate for offline evals → tune weights/decay/consolidation. Designed after the retrieval shape so it logs the right internals.

## Rebuild plan (preserve verified behavior)
Current `main` has a PGlite-only store with green tests (cross-launch persistence, owner-scoping, supersede invariants). The rebuild must **keep those guarantees** while moving to dual-store + tiers:
1. Introduce the file store + reindex alongside PGlite; make PGlite derived. Port existing invariants (owner-scope, supersede, provenance) onto the new layout; keep the cross-launch + owner-isolation tests green (adapt them to the new store).
2. Hybrid retrieval (port zuun's `search.ts`) + working/long-term split — the recall fix, now on the new foundation.
3. Tracing seam.
4. Core block + importance + ADD/UPDATE/DELETE/NOOP formation.
5. Consolidation (sleep-time, facts-only) + confidence.
6. Forgetting.
Each step a PR, each verified by the existing memory tests + the real-turn smoke ("what did we just do?" must surface recent work).

## Key open decisions for Codex / you
1. **File format:** Markdown+frontmatter (owner-readable) vs JSONL (machine-cheap). 
2. **One DB vs per-tier tables**, and whether to keep PGlite or consider plain SQLite+sqlite-vec (zuun uses sqlite + vec0; Roro uses PGlite+pgvector — is PGlite still the right engine if files are the truth?).
3. **Embedder** choice (defer-able now): keep nomic-768 vs evaluate a stronger local model.
4. **Rebuild vs in-place evolution:** a clean new `src/memory2` built right then swapped, vs evolving `src/memory` in place (riskier to the green tests).
5. **Scale ceiling:** years of episodes — do we cap/archive episodes, and does pgvector/FTS stay fast at 100k+ rows on-device?

---

## Codex max-effort review — corrections folded (verdict: build it, with these changes)

1. **Files-as-truth needs a manifest/journal, not just write-then-index.** Crash-safe contract: write content file (`tmp + fsync + rename`) → append/commit an op record to a manifest/journal → then update the index. On startup **reconcile `files > manifest > DB`; the DB never wins**. (This is the missing durability piece.)
2. **Engine: Codex recommends SQLite + FTS5 + sqlite-vec over PGlite** for a single-user Electron desktop app (native substrate, mature FTS5, backup tooling, fewer WASM/extension parts, matches zuun). Caveat: sqlite-vec is pre-v1. *(My refinement below — files-as-truth makes this swappable, so it may not need deciding now.)*
3. **File formats split:** Markdown+frontmatter **per durable object** (core/facts — owner-readable) + **sharded JSONL** for high-volume episodes/traces. NOT one giant JSONL (bad for delete/lineage/sync/inspection), NOT file-per-episode (too many files at 100k+).
4. **Rebuild `src/memory2` side-by-side; swap only after the existing contract tests pass** (cross-launch persistence, owner isolation, dup-healing, renderer-can't-write-facts, concurrent fact-write serialization) + new crash/reindex tests. Don't evolve in place.
5. **Minimal tiers in v1: `core`, `facts`, `episodes`, `traces`.** Working set = a *query/view* over recent episodes (not a source of truth). Graph = *reserved* schema fields, not active infra.
6. **Scale: the bottleneck is retrieval quality + prompt pollution, not DB speed.** Add a **summarization/archive hierarchy early** (raw episodes → session summaries → repo/project summaries → durable facts); don't retrieve raw old episodes without strong signal; shard episodes, cap candidate pools, filter owner/repo/time first.
7. **Add these fields NOW so we never migrate:** `schema_version, content_hash, deleted_at, updated_at, last_accessed_at, access_count, importance, confidence, ttl_policy, repo_id/path, source_event_id/run_id, lineage_ids, embedding_status, encryption_version`. **Design encryption-at-rest now** (privacy moat; v1 may default plaintext behind opt-in) and **hard-delete/tombstone semantics** for GDPR "forget" (supersede ≠ deletion).

### My refinement on the engine crux (#2)
PGlite already works, has green tests, ships contrib extensions Codex confirmed are present (`pgcrypto` for encryption-at-rest, `pg_trgm`/`tsvector` for FTS, `unaccent`, `uuid_ossp`), and is **WASM — which is *easier* Electron packaging** (no per-platform native rebuild) than sqlite-vec (a pre-v1 *native* extension needing electron-rebuild per arch). And the foundation's own principle — files-as-truth — makes the engine a **rebuildable index behind an interface**, i.e. *reversible*. So: **build the index behind a clean interface and keep PGlite for v1; swap to SQLite+sqlite-vec later only if a concrete limit appears.** Don't take pre-v1 + native-packaging risk now to fix a problem reversibility already neutralizes. (Codex leaned SQLite; this is the one place I'd diverge — and it's the key decision to make.)

---

## ENGINE DECISION (data-backed, from the spike)

**PGlite + pgvector with an HNSW index, behind a swappable `IndexStore` interface. sqlite-vec is the documented fallback.**

Benchmark (darwin-arm64, dim=768, k=10): pgvector HNSW holds **~1.5ms KNN flat from 10k→100k**; sqlite-vec is brute-force-only → **3→16→33ms** (linear, degrades at lifelong scale). Decisive for a lifelong corpus. Plus: WASM (easy Electron packaging) vs native; `pgcrypto` in-box for the chosen encrypt-by-default; already integrated + green tests. Caveats (non-decisive): my insert benchmark was confounded (per-row async PGlite vs batched sync sqlite) and the disk-size meter missed PGlite subdirs — but KNN-vs-scale (the decider) is sound.

Both engines store uncompressed float32 vectors (~3KB/row) → size is engine-independent → reinforces "summarization/archive tier early."

## Build sequence (each a PR, side-by-side `src/memory2`, swap after contract tests pass)
1. **Storage core:** `IndexStore` interface + files-as-truth (Markdown/frontmatter for durable, sharded JSONL for episodes) + manifest/journal + startup reconciliation (`files > manifest > DB`). PGlite derived index (mirror schema + full field set + HNSW). Encrypt-at-rest by default. Port the contract tests (cross-launch, owner-scope, supersede, renderer-can't-write-facts, concurrent fact serialization) + new crash/reindex tests.
2. **Hybrid retrieval** (port zuun): blended cosine+recency+importance, min-max normalized, +FTS (tsvector), working-vs-long-term split, drop the floor, per-component explainability. The recall fix, on the new foundation.
3. **Tracing seam** (records the score components + formation decisions).
4. **Core memory block** + importance + ADD/UPDATE/DELETE/NOOP formation.
5. **Consolidation** (sleep-time, facts-only, quality-gated) + confidence/decay.
6. **Forgetting** (TTL/decay/access-reinforcement) + **summarization/archive tier**.
7. Cut over orchestrator from `src/memory` → `src/memory2`; retire the old store.
