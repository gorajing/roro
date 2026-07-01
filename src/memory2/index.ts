// src/memory2/index.ts — the production singleton: memory2 behind the orchestrator's MemoryModule.
//
// siblings.loadMemory imports this module's namespace and calls remember/replaceFact/recall/getProfile/
// supersede on it. Those delegate to ONE lazily-created memory2 adapter (createMemory2Adapter) on the
// resolved data dir, using the brain's provider-aware embedder — the same wiring the retired
// src/memory store used, now over the files-as-truth + derived-index substrate. Tests use the adapter
// factory with a fake embedder; this module is exercised by the real-turn integration smoke.
//
// SINGLE-WRITER: the memory2 store is owned by the MAIN process only; the renderer reaches it via IPC.

import { join } from 'node:path';
import { createMemory2Adapter, type Memory2Adapter } from './adapter';
import { loadOrCreateCipher } from './keyManager';
import { buildSafeStorageWrapper, type SafeStorageLike } from './safeStorageWrapper';
import { resolveTracer, type Tracer, type TraceEvent } from './tracer';
import { resolveOllamaEmbedDim } from '../brain/ollama';
import type { Cipher } from './cipher';
import type {
  RememberInput,
  ReplaceFactInput,
  MemoryRow,
  MemoryMatch,
  RecallInput,
  ProfileFactSourceView,
  ProfileFactView,
} from '../shared/memory';

declare const process: { env: Record<string, string | undefined>; cwd(): string; platform: string };

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
// with the legacy PGlite store's files under the same configured DB root.
function resolveDataDir(): string {
  return process.env.RORO_DB_DIR ? join(process.env.RORO_DB_DIR, 'memory2') : join(process.cwd(), '.roro-memory2');
}

// ONE memoized RORO_TRACE sink, shared by BOTH the store's tracer (getAdapter, below) and the extraction
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

/** Fail loud on a wrong-shaped embedding before it reaches the index's vector(dim) bind. */
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

/** Load the at-rest cipher (encrypt-by-default): wrap the per-store DEK with Electron safeStorage. The
 *  electron import is DYNAMIC so non-Electron contexts (vite-node smoke) don't force-load it; in the real
 *  app this runs in the main process. Fails loud if the OS keychain is unavailable (keyManager). */
async function loadCipher(dir: string): Promise<Cipher> {
  const { safeStorage } = (await import('electron')) as unknown as { safeStorage: SafeStorageLike };
  const wrapper = buildSafeStorageWrapper(safeStorage, process.platform);
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

const getAdapter = lazySingleton<Memory2Adapter>(async () => {
  const dir = resolveDataDir();
  return createMemory2Adapter({
    dir,
    embed: embedText,
    dim: embeddingDim(),
    embedModel: embedModel(),
    cipher: await loadCipher(dir), // encrypt-at-rest by default
    tracer: sharedTracer(), // RORO_TRACE=1 → the shared JSONL observation tap (no-op otherwise)
  });
});

export async function remember(input: RememberInput): Promise<MemoryRow> {
  return (await getAdapter()).remember(input);
}
export async function replaceFact(input: ReplaceFactInput): Promise<MemoryRow> {
  return (await getAdapter()).replaceFact(input);
}
export async function reinforceFact(input: { owner_id: string; key: string }): Promise<MemoryRow | null> {
  return (await getAdapter()).reinforceFact(input);
}
export async function recall(input: RecallInput): Promise<MemoryMatch[]> {
  return (await getAdapter()).recall(input);
}
export async function getProfile(ownerId: string): Promise<MemoryRow[]> {
  return (await getAdapter()).getProfile(ownerId);
}
export async function profileFacts(ownerId: string): Promise<ProfileFactView[]> {
  return (await getAdapter()).profileFacts(ownerId);
}
export async function fixFact(ownerId: string, id: string, value: string): Promise<ProfileFactView> {
  return (await getAdapter()).fixFact(ownerId, id, value);
}
export async function verifyFact(ownerId: string, id: string): Promise<ProfileFactView> {
  return (await getAdapter()).verifyFact(ownerId, id);
}
export async function factSource(ownerId: string, id: string): Promise<ProfileFactSourceView> {
  return (await getAdapter()).factSource(ownerId, id);
}
export async function supersede(id: string): Promise<void> {
  return (await getAdapter()).supersede(id);
}
export async function forgetFact(ownerId: string, id: string): Promise<void> {
  return (await getAdapter()).forgetFact(ownerId, id);
}
