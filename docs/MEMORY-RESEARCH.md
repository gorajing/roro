# Roro Memory Architecture — Research Synthesis

Sources: external research (MemGPT/Letta, mem0, Zep/Graphiti, Stanford Generative Agents, hybrid-retrieval/forgetting literature) + Roro's own audit + **prior art in your repos (zuun, Zuhn, memric)**.

## The headline: everything converges on the same fix

Three independent sources prescribe the *same* recall architecture, and one of them is **already built and working in your own codebase**:

- **zuun** (`src/lib/search.ts:86-143`): hybrid score = **FTS5 bm25 + vector cosine + recency exp-decay**, each **min-max normalized to [0,1]**, weighted sum (default `fts=0.45, vec=0.45, recency=0.1`), env-configurable, with **per-component explainability** (`parts`).
- **Stanford Generative Agents** (the canonical formula copied by MemGPT/mem0/LangGraph): `score = recency + importance + relevance`, alphas=1, each min-max normalized, top-k 3-5. Their tuning note states Roro's exact failure: pure similarity "forgets recent work because it isn't phrased like the query."
- **The field**: drop hard similarity floors; blend recency; add lexical (RRF) for identifiers; split working vs long-term.

**Conclusion: we don't need to invent anything. We port zuun's hybrid search to Roro's PGlite+pgvector, using the `seq` column we already have for recency.** That's the recall fix, de-risked by your own production use.

## Roro's current state (audit) vs. the target

Strengths (keep): owner-scoping everywhere, atomic supersede-not-overwrite facts, embed provenance stamps, independent degradation (allSettled), the `seq` recency key, cross-launch recall. Gaps: recall is **cosine-only + 0.3 floor, ignores `seq`**; no lexical/FTS; no working-vs-long-term split; no importance; no consolidation; no forgetting/decay; no per-component explainability.

## Recommended architecture (layered)

### 1. Retrieval — the fix (port zuun)
- **Blended score** over a wider candidate pool: `w_rel*cosine + w_rec*recencyDecay(seq/created_at) + w_imp*importance`, each **min-max normalized**, top-k 3-5. Recency = exp decay (zuun's `exp(-ageDays/30)`; Generative Agents decays over *last access*, refreshing on hit — adopt that so used memories stay hot).
- **Add lexical** (PGlite FTS / or RRF fusion) so identifier/keyword queries ("the auth bug", a filename) that embeddings miss still hit. RRF (`Σ 1/(60+rank)`) sidesteps BM25-vs-cosine scale mismatch, needs no tuning.
- **Working-vs-long-term split**: temporal/meta queries ("what did we just do?") answered by **pure recency `ORDER BY seq DESC`**, bypassing vector search — cheaper and strictly correct. (This is FIX 1's "RECENT ACTIONS" channel, now backed by the literature + zuun.)
- **Drop the 0.3 floor** to a fallback that can never return zero when recent rows exist.
- **Explainability** (zuun's `parts`): return per-component scores with every match → directly feeds the tracing/eval layer below.
- Borrow zuun's safeguards: candidate cap (`limit*8`), min-max edge cases, configurable weights via env.

### 2. Core memory block (MemGPT/Letta) — upgrade the facts path
An always-in-prompt, size-capped **owner block** `{label, description, value, limit}` (persona + "what I know about you"), pinned every turn rather than re-retrieved. This is the "knows-you" moat made always-present; per-user by construction; supersede-not-overwrite. Layers over `getProfile`.

### 3. Formation / update (mem0 + zuun discipline)
- Generalize supersede → **ADD / UPDATE / DELETE / NOOP** (NOOP = dedup, DELETE = the "forget=delete-a-vector" primitive you already endorse).
- Add an **importance (1-10)** integer to the existing 1-fact extractor (Generative Agents prompt), stamped at write → feeds the blend.
- **Dedup-on-capture** (zuun's bodyHash within a window).

### 4. Consolidation — the get-smarter loop (Zuhn's model, zuun's caution)
This is where your two systems disagree productively:
- **Zuhn** distills raw → insights → principles with **confidence + decay + empirical-outcome updating** (predictions confirmed/falsified adjust confidence) and typed relationships. That's the "compounding moat."
- **zuun** deliberately does **NO auto-distillation** for session memory (avoids corpus pollution, context burn, poor LLM judgment).
- **Resolution for Roro:** Roro is session-memory (like zuun) wanting a light "knows-you" layer (like Zuhn). So: **adopt zuun's retrieval + capture discipline wholesale; adopt Zuhn's consolidation SELECTIVELY and only for the FACTS layer**, run **off the response path** (MemGPT "sleep-time compute" — an idle pass that distills recent episodes → durable facts, quality-gated). Never auto-distill episodes into the recall corpus (heed zuun).

### 5. Forgetting (retrieval-quality feature)
Unbounded add-all measurably tanks accuracy (cited 3×). Levers: **TTL by category** (facts=∞, transient context=short), **access-frequency reinforcement** (boost on hit, decay unused), **quality-gated addition** (skip non-novel/contradictory writes — ~10% gains alone).

### 6. Tracing & evals layer (your "layer tracing on top" question)
Tracing is the **observability tap at each seam**, riding the provenance memory already stamps (`payload.source`, `embed_model/embed_dim`):
- **Retrieve:** log candidates + per-component scores (cosine/recency/importance/lexical/final) + threshold + what surfaced — zuun already returns this as `parts`; we just persist it. *This is the line that would've shown `topSimilarity:0.21` instantly.*
- **Form/update:** log ADD/UPDATE/DELETE/NOOP decisions + importance.
- **Consolidate:** log inputs→derived fact (lineage: which episodes → which fact).
- **Two correlation keys:** `runId` (live per-turn) + memory-row `id` (fact lineage).
- It's a **one-way tap** → a local `RORO_TRACE=1` JSONL sink, never feeding back into live decisions. It is the **substrate for evals**: the trace of scores + consolidation decisions is exactly what an offline eval consumes to tune weights/decay/consolidation. Observe → eval → tune. **Designed after the retrieval shape** so it logs the right score components.

## Staged roadmap (sequencing)
1. **Hybrid retrieval** (port zuun): blended recency+relevance, drop floor, working-vs-long-term recency path. *Highest leverage; this is FIX 1, now de-risked.*
2. **Lexical/FTS + RRF** (identifier queries) + per-component explainability.
3. **Tracing seam** (record the score components + formation decisions) — instruments 1-2 and everything after.
4. **Core memory block** (always-in-prompt owner block).
5. **Importance + mem0 ADD/UPDATE/DELETE/NOOP** formation.
6. **Consolidation (sleep-time, facts-only, quality-gated)** + Zuhn-style confidence/decay.
7. **Forgetting (TTL/decay/access-reinforcement)** + **evals** on the trace data.

(1-3 are the immediate, machine-verifiable work; 4-7 are the compounding moat, sequenced as the corpus grows.)

## Open decisions
1. **Recency basis:** `seq` (deterministic) vs `created_at` (true time) vs last-access (Generative Agents, keeps used memories hot). Recommend last-access decay over `created_at`, `seq` as tiebreak.
2. **Lexical:** PGlite native FTS vs application-side RRF over two queries. (zuun uses SQLite FTS5; PGlite has `tsvector` — verify support.)
3. **Consolidation cadence:** idle/sleep-time vs every-N-turns; and how aggressive (zuun says conservative).
4. **Core memory block size/refresh policy.**
5. Whether to mirror zuun's **markdown-source-of-truth + DB-as-index** (grep-able, git-able, reindexable) — bigger change, but it's a proven robustness pattern.
