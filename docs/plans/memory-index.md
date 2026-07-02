# Memory index swap + contract unification — build spec (W5, task 13)

> Synthesized 2026-07-02 from a 3-hat design panel (index-engine / durability-keeper / contract-unifier).
> Status: BUILD SPEC of record. Adjudications noted inline. Engine first behind the untouched
> IndexStore seam; contract second; deletions last; CI-parallel flip last of all.

## Shape

Replace PGlite/pgvector with: `src/memory2/memIndex.ts` (pure in-memory IndexStore, ZERO I/O) +
`src/memory2/vectorCache.ts` (the embeddings sidecar — a CACHE with zero authority). Then unify the
contract on Entry/tier and delete adapter.ts. ADJUDICATED (2-of-3 + strongest-invariant): the cache
is a separate module consulted by memoryStore's indexEntry/reindex — NOT inside memIndex; the
applied_seq cursor goes EPHEMERAL (in-memory, 0 at every open) and reconcile replays the FULL
manifest every launch — rebuild-from-files becomes the NORMAL open path (files-as-truth exercised
every single launch), with the cache making it cheap (zero embed calls on a warm open). The
sidecar persists NO cursor and NO authority: losing it or its tail means re-embedding, never data
loss.

## The sidecar: `<storeDir>/index/vectors.jsonl`

- Line 1 header `{kind:'roro-vector-cache', v:1, embedModel, dim}`; data lines
  `{h:<contentHash>, v:<base64 L2-normalized Float32Array LE>}`. Nothing else EVER: no text, no
  factKey, no ownerId, no id, no seq (privacy assertion test required). contentHash is the entry's
  stamped keyed-HMAC (not reversible); vectors are plaintext BY DOCUMENTED DESIGN (cipher.ts header).
- Same `index/` subdir PGlite used, so `rm -rf <dir>/index` keeps its exact test meaning.
- Append without per-line fsync (zero-authority cache; a lost tail = a few re-embeds next open);
  fsync once in close() and after compact rewrites (atomic tmp → fsync → rename → fsyncDir).
  Dedup appends via an in-memory persisted-hash set (reinforce re-embeds → same hash → no growth).
- OPEN rules — two classes, never conflated: (a) IDENTITY REFUSAL: parseable header whose
  (embedModel, dim) mismatches config THROWS with the pglite guard's actionable message shape
  ('vector spaces are not mixable…'; /dimension/i and /model/i patterns preserved — port both guard
  tests 1:1). (b) SELF-HEAL: missing file → cold + loud warn; torn TRAILING line → drop tail;
  interior corruption / bad header → quarantine to vectors.jsonl.corrupt-<ts>, start fresh, loud
  warn — NEVER crash open.

## The engine: memIndex.ts

`Map<string, {entry, vec?: Float32Array}>` flat (no owner sharding — self-capped 5k/owner, single
user); vectors L2-normalized Float32Array at insert; query normalized once; similarity = dot
product (float64 accumulator; parity with pgvector float4). Deterministic tiebreak: similarity
desc, then entry.seq desc. Zero-norm → treated as vectorless, warn once. Implements ALL IndexStore
methods 1:1 (upsert incl. embedding→null on omitted vector, owner-scoped KNN, superseded/deleted
exclusion, active-fact (ownerId,factKey) uniqueness THROW, episodesToPrune ranking parity,
reindexFrom = embed-all-first + atomic Map swap + failure-preserves-existing, dim-length throw,
count/maxSeq/getAppliedSeq/setAppliedSeq — the cursor methods now ephemeral). The blend
(memoryScore.ts), recency guarantee, and tracer recall-event shape move UNCHANGED — byte-compatible
trace candidates.

## Open sequence (memoryStore.ts factory swap only)

vectorCache.open (identity check → refuse; else load + self-heal) → EXISTING liveEntries/reconcile
replays the manifest from seq 0 — indexEntry consults the cache by contentHash BEFORE calling
embed (hit → attach, no embed; miss → embed + write-through). Embed outage: today's per-op catch
(row indexed vectorless, embeddingStatus 'failed', cursor advances) — the store OPENS and serves
recent/getProfile/guaranteed-recency recall exactly like today's degradation. Crash-window: vec
append precedes cursor... (cursor is ephemeral — the analysis reduces to: a lost vec line = one
re-embed; nothing else possible).

## Re-armed durability tests (the spurious-green lesson — REQUIRED, same commit as the cutover)

- NORMAL-restart: assert ZERO store-content embed calls at open (counting embedder) AND cosine
  recall still ranks (the cache served).
- FILES-AS-TRUTH (rm <dir>/index): assert embeds ≥ live embeddable count AND full survival after
  decrypt.
- NEW third case: cold open with a THROWING embedder still opens and serves getProfile + recent.
- Sabotage suite: torn tail tolerated; interior corruption → quarantine + fresh + loud; identity
  mismatch → refusal with remedy text; embed-outage open → next-launch self-heal (vectorless rows
  get embedded on a later open via reindex-on-miss… verify the actual mechanism and pin it).
- The implementer MUST sabotage-verify: break the cache-consult line → warm test fails on embed
  count; break reconcile → files-as-truth test fails.

## Contract unification (after the engine commits are green)

- src/shared/memory.ts REWRITTEN as the canonical contract: Tier/Entry/FactPayload move in;
  `EpisodeKind = 'observation'|'narration'|'action'` persisted as Entry.episodeKind (episode tier
  only) — 'fact' stops being a kind; `MemoryMatch` becomes the wrapper
  `{entry: Entry, similarity: number, guaranteed: boolean}` (the #138 typed guarantee survives);
  src/memory2/types.ts becomes a re-export.
- importanceFor keyed by EpisodeKind ({observation:6, action:4, narration:3}); the fact:8 row
  deleted as dead code (replaceFact never stamped importance; recall excludes facts).
- importance/repoId stamping moves from adapter.ts into the facade (src/memory2/index.ts).
- RENDERER-FACING SHAPES FROZEN byte-for-byte: ProfileFactView/ProfileFactSourceView/FactSource
  keep snake_case; all channel names unchanged; only the dev-flag debug bridge
  (memoryRemember/memoryRecall) changes payload shape.
- Order: facade + Entry-based profileFacts land standalone and tested → ONE atomic consumer-flip
  commit (~9 files: memory2/index, memoryContext, factStore, orchestrator facade sinks, ipc,
  preload, companion.d.ts, memorySpine test) → adapter.ts + legacy shapes deleted TERMINAL.

## Manifest compaction (day one)

Seq-PRESERVING rewrite (never renumber) from just-reconciled live state in original seq order;
drop op-pairs for tombstoned ids (delete op dropped only when no surviving put AND log-tier-or-file
confirmed absent); collapse per-file overwrite chains to the max-seq entry-carrying op; keep
superseded-fact puts; ALWAYS retain/append the globally max-seq op (pins nextSeq across restarts);
atomic tmp → fsync → rename; trigger on open inside the serialize chain when
ops > max(1000, 3×liveCount). Tests: seq preservation, nextSeq pinning, tombstone permanence
post-compaction+reindex, crash atomicity (tmp present + original intact).

## Commit order (each gated: full vitest serialized + tsc + eslint 0 errors; memory2 suite +
crosslaunch durability + orchestrator pins + ipc tests green throughout)

- C0: this spec → docs/plans/memory-index.md.
- C1: vectorCache.ts + tests (identity refusal ported, self-heal matrix, privacy assertion,
  compact rewrite). Nothing imports it.
- C2: memIndex.ts + an IndexStore CONFORMANCE suite generalized from pgliteIndex.test.ts and run
  against BOTH engines (pglite arm proves parity while both exist).
- C3: cutover — factory swap + cache consult in indexEntry/reindex + the re-armed durability tests
  + sabotage suite + embed-outage case, SAME commit (they break or go spurious otherwise).
- C4: manifest compaction + tests.
- C5: kill PGlite — delete pgliteIndex.ts/.test, the @electric-sql deps (npm install
  --package-lock-only), the Vite ?url WASM shims; conformance drops the pglite arm.
- C6: facade grows stamping + Entry-based profileFacts (standalone, tested).
- C7: the atomic consumer flip (~9 files).
- C8: delete adapter.ts + legacy MemoryRow/kind shapes; grep proves zero legacy references.
- C9 (isolated, LAST): remove vitest fileParallelism:false (keep raised timeouts) — gated on 3
  CONSECUTIVE full-suite green runs locally; note for CI.

## Known traps (bake in)

- The worktree node_modules SYMLINK is not matched by the `node_modules/` ignore pattern — never
  let `git add -A` stage it (check `git status --short` for it before every commit).
- ipc.factProposals + memoryContext tests build MemoryMatch literals — the wrapper-shape flip (C7)
  must update those fakes in the same commit (grep 'similarity:' across tests).
- eslint in a `.claude/` worktree needs `--no-ignore` scoped to source dirs (ESLint 8 dot-dir
  default-ignore); verify output parity against the repo pattern.
- packages/voice is OUT of the root graph — do not touch it; the voice CI job only triggers on its
  paths.
