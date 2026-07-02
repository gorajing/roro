// src/memory2/index.ts — the production memory facade (the Entry contract) + its singleton.
//
// siblings.loadMemory imports this module's namespace and calls remember/replaceFact/recall/
// getProfile/... on it. Those delegate to ONE lazily-created MemoryFacade over a memory2 store on the
// resolved data dir, using the brain's provider-aware embedder. The facade owns the write-path
// STAMPING (tier from the episode kind, deterministic importance, repoPath → derived repoId) so no
// caller hand-assembles those, and it maps the store's blend-ranked hits into the public MemoryMatch
// wrapper ({entry, similarity, guaranteed}). createMemoryFacade is exported for tests (the same
// wiring over an injected store — no singleton, no env).
//
// SINGLE-WRITER: the memory2 store is owned by the MAIN process only; the renderer reaches it via IPC.

import { join } from 'node:path';
import { createMemoryStore, type MemoryStore } from './memoryStore';
import { factSource as factSourceOf, fixFact as fixFactOf, profileFacts as profileFactsOf, verifyFact as verifyFactOf } from './profileFacts';
import { importanceFor } from './importance';
import { repoId } from './repoId';
import { loadOrCreateCipher } from './keyManager';
import { buildSafeStorageWrapper } from './safeStorageWrapper';
import { ports } from '../ports/ports';
import { resolveTracer, type Tracer, type TraceEvent } from './tracer';
import { resolveOllamaEmbedDim } from '../brain/ollama';
import type { Cipher } from './cipher';
import type {
  Entry,
  MemoryMatch,
  RecallInput,
  RememberEpisodeInput,
  ProfileFactSourceView,
  ProfileFactView,
} from '../../shared/memory';

declare const process: { env: Record<string, string | undefined>; cwd(): string; platform: string };

// ---------------------------------------------------------------------------
// The facade: the Entry-contract MemoryModule surface over an injected store
// ---------------------------------------------------------------------------

/** The public memory surface (what siblings.MemoryModule picks, minus traceExtraction). */
export interface MemoryFacade {
  /** Durably store one episode (stamps tier/episodeKind/importance/repoId). Facts are unrepresentable
   *  here — they go through replaceFact's atomic supersede. */
  remember(input: RememberEpisodeInput): Promise<Entry>;
  /** Atomic supersede-all-for-key + insert (≤1 active fact per key). */
  replaceFact(input: { ownerId: string; factKey: string; text: string; payload?: unknown; sessionId?: string }): Promise<Entry>;
  /** Corroborate the active fact for (ownerId, factKey) in place. */
  reinforceFact(input: { ownerId: string; factKey: string }): Promise<Entry | null>;
  /** Owner-scoped hybrid episodic recall, blend-ranked; `guaranteed` marks the recency-promised heads. */
  recall(input: RecallInput): Promise<MemoryMatch[]>;
  /** Active profile facts, strongest (effective confidence) first. */
  getProfile(ownerId: string): Promise<Entry[]>;
  /** Renderer-safe active facts for the Memory panel (FROZEN snake_case views). */
  profileFacts(ownerId: string): Promise<ProfileFactView[]>;
  /** Replace one active fact value by id. Owner/key are resolved from the active profile. */
  fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView>;
  /** Corroborate one active fact by id. Owner/key are resolved from the active profile. */
  verifyFact(ownerId: string, id: string): Promise<ProfileFactView>;
  /** Return safe local source metadata for one active fact. */
  factSource(ownerId: string, id: string): Promise<ProfileFactSourceView>;
  /** Mark an entry superseded (hidden from getProfile/recall) — supersede-not-overwrite. */
  supersede(id: string): Promise<void>;
  /** HARD-delete one of the owner's active facts (the Forget panel — M8). Owner-scoped + active-only: a no-op
   *  if `id` isn't among this owner's current profile facts (so it can't delete an arbitrary or other-owner id). */
  forgetFact(ownerId: string, id: string): Promise<void>;
  close(): Promise<void>;
}

function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}
function normalizeK(k = 5): number {
  if (!Number.isInteger(k) || k < 1) throw new Error(`recall k must be a positive integer, got ${k}`);
  return k;
}

/** The production wiring over an injected store — exported so tests exercise the REAL facade
 *  (stamping, wrapper mapping, owner guards) without the env-bound singleton below. */
export function createMemoryFacade(store: MemoryStore): MemoryFacade {
  return {
    async remember(input: RememberEpisodeInput): Promise<Entry> {
      requireText(input.ownerId, 'remember ownerId');
      requireText(input.text, 'remember text');
      return store.remember({
        tier: 'episode',
        ownerId: input.ownerId,
        sessionId: input.sessionId,
        text: input.text,
        payload: input.payload,
        // Persist WHICH episodic channel wrote the row — the kind survives storage.
        episodeKind: input.kind,
        // Deterministic importance by kind (M5): nudges the recall blend so the user's own words rank
        // above the cat's paraphrase. Derived here so EVERY remember() is stamped without each caller
        // passing it.
        importance: importanceFor(input.kind),
        // Project scope (M5b): stamp the repo path + a stable derived id so recall can boost same-repo
        // memories. Absent repoPath → empty repoId → an unscoped (global) memory.
        repoPath: input.repoPath,
        repoId: repoId(input.repoPath ?? ''),
      });
    },

    replaceFact(input): Promise<Entry> {
      return store.replaceFact(input);
    },

    reinforceFact(input): Promise<Entry | null> {
      return store.reinforceFact(input);
    },

    async recall(input: RecallInput): Promise<MemoryMatch[]> {
      requireText(input.query, 'recall query');
      requireText(input.ownerId, 'recall ownerId');
      const k = normalizeK(input.k);
      const hits = await store.recall({ query: input.query, ownerId: input.ownerId, k, repoId: input.repoId });
      // similarity = RAW cosine; recency-only rows have none -> 0. The hybrid improvement lives in the
      // result ORDER (blend-ranked). `guaranteed` carries the store's recency promise through the
      // contract so caller-side similarity floors exempt those rows BY TYPE (they carry cosine 0 and a
      // naive floor would drop exactly them).
      return hits.map((h) => ({ entry: h.entry, similarity: h.cosine ?? 0, guaranteed: h.guaranteed }));
    },

    getProfile(ownerId: string): Promise<Entry[]> {
      return store.getProfile(ownerId);
    },

    // The trust-loop helpers are Entry-based: the store IS the deps (same signatures); their OUTPUT
    // views stay the frozen renderer shapes.
    profileFacts(ownerId: string): Promise<ProfileFactView[]> {
      return profileFactsOf(store, ownerId);
    },

    fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView> {
      return fixFactOf(store, ownerId, id, value);
    },

    verifyFact(ownerId: string, id: string): Promise<ProfileFactView> {
      return verifyFactOf(store, ownerId, id);
    },

    factSource(ownerId: string, id: string): Promise<ProfileFactSourceView> {
      return factSourceOf(store, ownerId, id);
    },

    supersede(id: string): Promise<void> {
      return store.supersede(id);
    },

    async forgetFact(ownerId: string, id: string): Promise<void> {
      // Verify the id is one of THIS owner's active facts before the hard delete — store.forget removes
      // by tier+id without an owner check, so this is the owner-scope + active-only guard (never delete
      // an id the owner doesn't actively have; getProfile is owner-scoped).
      const owned = (await store.getProfile(ownerId)).some((e) => e.id === id);
      if (!owned) return;
      await store.forget({ tier: 'fact', id, ownerId });
    },

    close(): Promise<void> {
      return store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// The production singleton (env-resolved dir, brain embedder, keychain cipher)
// ---------------------------------------------------------------------------

// The brain's embedder determines the vector space + dimension (local nomic-embed-text → 768, or
// OLLAMA_EMBED_DIM when overriding). Shares brain/ollama's resolver so this and the brain can never
// desync; stamped on every entry (embedModel/embedDim).
function embeddingDim(): number {
  return resolveOllamaEmbedDim(process.env.OLLAMA_EMBED_DIM);
}
function embedModel(): string {
  return process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
}

// memory2's layout (durable files + derived index/ subdir) lives in its own dir so it never collides
// with the legacy store's files under the same configured DB root.
function resolveDataDir(): string {
  return process.env.RORO_DB_DIR ? join(process.env.RORO_DB_DIR, 'memory2') : join(process.cwd(), '.roro-memory2');
}

// ONE memoized RORO_TRACE sink, shared by BOTH the store's tracer (getFacade, below) and the extraction
// observability sink — so a single writer appends to trace.jsonl instead of two independent ones. NOOP
// (zero overhead) unless RORO_TRACE=1.
let _tracer: Tracer | undefined;
function sharedTracer(): Tracer {
  return (_tracer ??= resolveTracer(resolveDataDir()));
}

// Extraction-observability sink (M-magic-moment): emit per-turn extract outcomes (gated/noop/stored/
// reinforced/failed) through the shared sink, so the orchestrator's runFactExtraction makes "0 known
// facts" diagnosable without a second tracing mechanism. Never throws (the JSONL tracer swallows write
// errors — diagnostics must never disturb a turn).
export function traceExtraction(event: TraceEvent): void {
  sharedTracer().emit(event);
}

type BrainEmbed = (text: string) => Promise<number[]> | number[];
type BrainModule = { embed?: unknown; default?: { embed?: unknown } };
let brainEmbed: BrainEmbed | null = null;
let checkedBrainEmbed = false;

async function loadBrainEmbed(): Promise<BrainEmbed> {
  if (checkedBrainEmbed && brainEmbed) return brainEmbed;
  // brain is a COMMITTED sibling — a failed import is a real bug; let it propagate (fail loud). Memoize
  // only on success so a transient failure isn't cached as a permanent "no embedder".
  const brain = (await import('../brain')) as BrainModule;
  const candidate = typeof brain.embed === 'function' ? brain.embed : brain.default?.embed;
  if (typeof candidate !== 'function') {
    throw new Error('brain.embed is unavailable — the brain module must export an embed() function');
  }
  brainEmbed = candidate as BrainEmbed;
  checkedBrainEmbed = true;
  return brainEmbed;
}

/** Fail loud on a wrong-shaped embedding before it reaches the index's dim-checked insert. */
function assertEmbedding(value: number[]): number[] {
  const dim = embeddingDim();
  if (!Array.isArray(value)) throw new Error('Embedding provider returned a non-array embedding');
  if (value.length !== dim) throw new Error(`Embedding dimension ${value.length} does not match vector(${dim})`);
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('Embedding provider returned a non-numeric embedding value');
  }
  return value;
}

async function embedText(text: string): Promise<number[]> {
  return assertEmbedding(await (await loadBrainEmbed())(text));
}

/** Load the at-rest cipher (encrypt-by-default): wrap the per-store DEK with the OS keychain. The raw
 *  safeStorage object comes through the KeyWrapperPort (the shell supplies Electron's; core never imports
 *  electron), so a non-Electron context that reaches here fails loud "port not registered". The wrapper
 *  POLICY stays here. Fails loud if the OS keychain is unavailable (keyManager). */
async function loadCipher(dir: string): Promise<Cipher> {
  const wrapper = buildSafeStorageWrapper(ports().keyWrapper.getSafeStorage(), process.platform);
  return loadOrCreateCipher({ dir, wrapper });
}

/** Memoize an async build, but CLEAR the cache on rejection so a transient failure can be retried.
 *  A caching-the-rejection singleton would brick memory if the first call hit a not-yet-ready OS keychain
 *  (safeStorage) — and siblings.loadMemory is written to re-attempt failed loads, which this preserves. */
export function lazySingleton<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const p = factory();
      pending = p;
      p.catch(() => { if (pending === p) pending = null; });
    }
    return pending;
  };
}

const getFacade = lazySingleton<MemoryFacade>(async () => {
  const dir = resolveDataDir();
  return createMemoryFacade(await createMemoryStore({
    dir,
    embed: embedText,
    dim: embeddingDim(),
    embedModel: embedModel(),
    cipher: await loadCipher(dir), // encrypt-at-rest by default
    tracer: sharedTracer(), // RORO_TRACE=1 → the shared JSONL observation tap (no-op otherwise)
  }));
});

export async function remember(input: RememberEpisodeInput): Promise<Entry> {
  return (await getFacade()).remember(input);
}
export async function replaceFact(input: { ownerId: string; factKey: string; text: string; payload?: unknown; sessionId?: string }): Promise<Entry> {
  return (await getFacade()).replaceFact(input);
}
export async function reinforceFact(input: { ownerId: string; factKey: string }): Promise<Entry | null> {
  return (await getFacade()).reinforceFact(input);
}
export async function recall(input: RecallInput): Promise<MemoryMatch[]> {
  return (await getFacade()).recall(input);
}
export async function getProfile(ownerId: string): Promise<Entry[]> {
  return (await getFacade()).getProfile(ownerId);
}
export async function profileFacts(ownerId: string): Promise<ProfileFactView[]> {
  return (await getFacade()).profileFacts(ownerId);
}
export async function fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView> {
  return (await getFacade()).fixFact(ownerId, id, value);
}
export async function verifyFact(ownerId: string, id: string): Promise<ProfileFactView> {
  return (await getFacade()).verifyFact(ownerId, id);
}
export async function factSource(ownerId: string, id: string): Promise<ProfileFactSourceView> {
  return (await getFacade()).factSource(ownerId, id);
}
export async function supersede(id: string): Promise<void> {
  return (await getFacade()).supersede(id);
}
export async function forgetFact(ownerId: string, id: string): Promise<void> {
  return (await getFacade()).forgetFact(ownerId, id);
}
