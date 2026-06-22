> 🔧 **STORAGE REPOINT (2026-06-21) — see [HANDOFF.md](../../../HANDOFF.md).** The LOGIC here (owner_id, fact extractor, recall composition, the cross-launch fixture) is store-agnostic and valid, but the storage adapter (Task 1 Insforge SQL/RPCs, Task 3 `src/memory/index.ts` insforgeFetch) must be **re-authored for local PGlite + pgvector**. Build A.5 on PGlite, not Insforge.

# Roro Phase A.5 — Memory Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Roro remember a user across full app restarts by minting a device-stable `owner_id`, owner-scoping the memory store, and writing thin source-linked profile facts — proven by a cross-launch fixture (a fact taught in "launch A" is recalled in "launch B").

**Architecture:** Identity lives in the MAIN process (`identity.ts`), never the renderer. The Insforge/pgvector store gains an `owner_id` column and a `superseded` flag; all reads/writes go through POST-insert + three RPCs (`match_memory` gains `p_owner_id`; new `get_profile`, `supersede_memory`). A thin 1-fact-per-turn extractor (LLM in the brain, supersede logic in a pure `factStore` module) runs OFF the critical path after each turn. Recall composes a **labeled** facts-segment + episodic matches into the existing `DecideInput.memory` string — no change to the frozen `Decision`/`ActionEvent` contracts.

**Tech Stack:** TypeScript, Electron 42 (main process), Insforge (hosted Postgres + pgvector), Nebius (DeepSeek decide + Qwen3 embeddings), Vitest (colocated `*.test.ts`, run with `npx vitest run`).

## Global Constraints

- **Stay on Insforge for M1.** No PGlite/Postgres swap, no re-embedding job. Build `owner_id` + `fact` rows on the existing Insforge project (`Qwen3-Embedding-8B` @ 1536 dims).
- **`owner_id` is device-local and MAIN-process-owned.** Minted to `app.getPath('userData')/owner.json`. The renderer NEVER supplies `owner_id`; main injects it from `identity.getOwnerId()`.
- **Keep `session_id` on every row during transition.** `match_memory` keeps `p_session_id` (optional) so the old path still works; recall becomes `owner_id`-primary.
- **Facts are durable product data:** owner-scoped; **source-linked** (`payload = { key, value, source: { session_id, turn_ts } }`); **superseded, never silently overwritten** (`superseded boolean default false`; `get_profile` returns only active facts); **null-when-unsure** (the extractor writes no row when unsure — a silent cat beats a confidently-wrong one).
- **Memory and extraction are best-effort and OFF the critical path.** A memory failure logs loud but never aborts a turn; fact extraction is fire-and-forget after the terminal event.
- **No frozen-contract changes.** `Decision`, `DecideInput` (still `{ transcript; memory?; screen? }`), and the 11-kind `ActionEvent` union are untouched in A.5. (The `status` kind arrives in C1, not here.)
- **Insforge API-shape verification points (cannot be read from here — confirm against the live project's SQL editor before/while applying Task 1):** the exact existing `match_memory` argument signature, the `memory` table's embedding column name + `vector(1536)` type, and that RPCs are reachable at `POST /api/database/rpc/<name>`. The plan assumes PostgREST-style RPC conventions consistent with `src/memory/index.ts`.
- **Embedding provenance stamp (added per the substrate eval, 2026-06-21 — `docs/superpowers/specs/2026-06-21-nero-substrate-decision.md`):** the migration adds `embed_model` + `embed_dim` columns and `remember()` stamps them on every write (`Qwen/Qwen3-Embedding-8B` / `1536`). This is the ONE genuinely irreversible pre-corpus item: it makes a future re-embed-on-tier-change auditable (which model wrote which row) — NOT a cross-tier shared vector space (the design re-embeds on tier change, never mixes spaces). The read-side dimension guard already exists (`assertEmbedding`); do not add another. The RPCs do NOT return these columns in M1 (keep their `RETURNS TABLE` minimal) — stamping on write is the whole job.

---

### Task 1: SQL migration — owner_id, superseded, and the owner-scoped RPCs

**Files:**
- Create: `db/migrations/2026-06-21-owner-id.sql`
- Reference (do not edit yet): `src/memory/index.ts:46-69` (the `recall` RPC call shape), `src/shared/memory.ts`

**Interfaces:**
- Produces (for Task 3): RPC `match_memory(query_embedding vector(1536), k integer, p_session_id text default null, p_owner_id text default null)`; RPC `get_profile(p_owner_id text)`; RPC `supersede_memory(p_id uuid)`; columns `memory.owner_id text`, `memory.superseded boolean default false`.

- [ ] **Step 1: Write the migration SQL**

Create `db/migrations/2026-06-21-owner-id.sql`:

```sql
-- Roro A.5: owner-scope the memory store + thin profile facts.
-- Apply against the Insforge project's Postgres (SQL editor). Idempotent where possible.
-- VERIFY FIRST in the SQL editor: the existing match_memory(...) argument signature and the
-- embedding column name/type. Adjust the DROP signature below to match exactly before running.

alter table memory add column if not exists owner_id text;
alter table memory add column if not exists superseded boolean not null default false;
alter table memory add column if not exists embed_model text;
alter table memory add column if not exists embed_dim int;

-- Provenance stamp: backfill existing rows so a future re-embed-on-tier-change is auditable
-- (which model wrote which vector). The design re-embeds on tier change and NEVER mixes spaces.
update memory set embed_model = 'Qwen/Qwen3-Embedding-8B', embed_dim = 1536 where embed_model is null;

create index if not exists memory_owner_idx on memory (owner_id);
create index if not exists memory_owner_fact_idx
  on memory (owner_id, created_at desc)
  where kind = 'fact' and superseded = false;

-- A Postgres function signature change requires DROP + CREATE (you cannot add a param in place).
-- Confirm this DROP signature matches the live function before running.
drop function if exists match_memory(vector, integer, text);

create or replace function match_memory(
  query_embedding vector(1536),
  k integer,
  p_session_id text default null,
  p_owner_id text default null
)
returns table (
  id uuid,
  owner_id text,
  session_id text,
  kind text,
  text text,
  payload jsonb,
  superseded boolean,
  created_at timestamptz,
  similarity double precision
)
language sql stable as $$
  select m.id, m.owner_id, m.session_id, m.kind, m.text, m.payload, m.superseded, m.created_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from memory m
  where (p_owner_id is null or m.owner_id = p_owner_id)
    and (p_session_id is null or m.session_id = p_session_id)
    and coalesce(m.superseded, false) = false
  order by m.embedding <=> query_embedding
  limit k;
$$;

-- Active (non-superseded) profile facts for an owner, newest first. Excludes the embedding column.
create or replace function get_profile(p_owner_id text)
returns table (
  id uuid,
  owner_id text,
  session_id text,
  kind text,
  text text,
  payload jsonb,
  superseded boolean,
  created_at timestamptz
)
language sql stable as $$
  select m.id, m.owner_id, m.session_id, m.kind, m.text, m.payload, m.superseded, m.created_at
  from memory m
  where m.owner_id = p_owner_id
    and m.kind = 'fact'
    and coalesce(m.superseded, false) = false
  order by m.created_at desc;
$$;

-- Mark one row superseded (the supersede-not-overwrite primitive + the future "forget" primitive).
create or replace function supersede_memory(p_id uuid)
returns void
language sql as $$
  update memory set superseded = true where id = p_id;
$$;
```

- [ ] **Step 2: Commit the migration artifact**

```bash
git add db/migrations/2026-06-21-owner-id.sql
git commit -m "feat(memory): A.5 SQL migration — owner_id, superseded, owner-scoped RPCs"
```

> **Note:** Applying this to the live Insforge project is verified end-to-end in **Task 8** (it needs Insforge DB access). The code Tasks 2–7 are CI-testable without it (fakes + mocked fetch).

---

### Task 2: Device-stable `owner_id` identity module

**Files:**
- Create: `src/main/identity.ts`
- Test: `src/main/identity.test.ts`

**Interfaces:**
- Produces: `parseOwnerFile(contents: string): { ok: true; id: string } | { ok: false }`; `loadOrMintOwnerId(dir: string): Promise<{ id: string; minted: boolean }>` (throws `OwnerCorruptError` on a present-but-garbled file — never silent re-mint); `initOwnerId(): Promise<string>` (Electron boot wrapper; last-resort LOUD re-mint on corruption); `getOwnerId(): string` (sync, cached; throws if not initialized).

- [ ] **Step 1: Write the failing test**

Create `src/main/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOwnerFile, loadOrMintOwnerId, OwnerCorruptError } from './identity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('parseOwnerFile', () => {
  it('accepts a well-formed owner file', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseOwnerFile(JSON.stringify({ owner_id: id }))).toEqual({ ok: true, id });
  });
  it('rejects garbage / missing id', () => {
    expect(parseOwnerFile('not json')).toEqual({ ok: false });
    expect(parseOwnerFile(JSON.stringify({ owner_id: 'nope' }))).toEqual({ ok: false });
    expect(parseOwnerFile(JSON.stringify({}))).toEqual({ ok: false });
  });
});

describe('loadOrMintOwnerId', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nero-owner-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('mints a v4 uuid and writes it when no file exists', async () => {
    const { id, minted } = await loadOrMintOwnerId(dir);
    expect(minted).toBe(true);
    expect(id).toMatch(UUID_RE);
    const onDisk = JSON.parse(await readFile(join(dir, 'owner.json'), 'utf8'));
    expect(onDisk.owner_id).toBe(id);
  });

  it('returns the SAME id on a second load (stability across launches)', async () => {
    const first = await loadOrMintOwnerId(dir);
    const second = await loadOrMintOwnerId(dir);
    expect(second.minted).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('writes atomically (no leftover .tmp file)', async () => {
    await loadOrMintOwnerId(dir);
    const files = await readdir(dir);
    expect(files).toEqual(['owner.json']);
  });

  it('throws OwnerCorruptError on a garbled file — never silently re-mints', async () => {
    await writeFile(join(dir, 'owner.json'), '{ corrupt');
    await expect(loadOrMintOwnerId(dir)).rejects.toBeInstanceOf(OwnerCorruptError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/identity.test.ts`
Expected: FAIL — `Cannot find module './identity'` (or `parseOwnerFile is not a function`).

- [ ] **Step 3: Implement the module**

Create `src/main/identity.ts`:

```ts
// src/main/identity.ts — the device-stable owner_id (the un-retrofittable memory spine).
// MAIN-process only. The renderer never sees or supplies this; the orchestrator injects it.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Thrown when owner.json exists but is unreadable/garbled — we refuse to silently re-mint. */
export class OwnerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerCorruptError';
  }
}

export function parseOwnerFile(contents: string): { ok: true; id: string } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false };
  }
  const id = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).owner_id : undefined;
  return typeof id === 'string' && UUID_RE.test(id) ? { ok: true, id } : { ok: false };
}

/**
 * Load owner.json from `dir`, or mint + atomically write a new v4 uuid if absent.
 * A PRESENT-but-garbled file throws OwnerCorruptError (the caller decides whether to re-mint) —
 * a silent re-mint would orphan all prior memory, the exact failure owner_id exists to prevent.
 */
export async function loadOrMintOwnerId(dir: string): Promise<{ id: string; minted: boolean }> {
  const path = join(dir, 'owner.json');
  let contents: string | null = null;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (contents !== null) {
    const parsed = parseOwnerFile(contents);
    if (parsed.ok) return { id: parsed.id, minted: false };
    throw new OwnerCorruptError(`owner.json at ${path} is present but unreadable`);
  }

  const id = randomUUID();
  await atomicWriteJson(path, { owner_id: id });
  return { id, minted: true };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path); // rename is atomic on the same filesystem
}

let cached: string | null = null;

/** Boot wrapper (call once in main.ts whenReady). Last-resort LOUD re-mint on corruption. */
export async function initOwnerId(): Promise<string> {
  const dir = app.getPath('userData');
  try {
    const { id, minted } = await loadOrMintOwnerId(dir);
    if (minted) console.log('[identity] minted new owner_id');
    cached = id;
    return id;
  } catch (err) {
    if (err instanceof OwnerCorruptError) {
      console.error(
        '[identity] owner.json CORRUPT — re-minting as a last resort. PRIOR MEMORY WILL BE ORPHANED.',
        err.message,
      );
      const id = randomUUID();
      await atomicWriteJson(join(dir, 'owner.json'), { owner_id: id });
      cached = id;
      return id;
    }
    throw err;
  }
}

/** Sync accessor for the orchestrator. Throws if initOwnerId() has not run. */
export function getOwnerId(): string {
  if (!cached) throw new Error('[identity] getOwnerId() called before initOwnerId()');
  return cached;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/identity.test.ts`
Expected: PASS (6 tests). `parseOwnerFile` + `loadOrMintOwnerId` (mint/stability/atomic/corrupt).

- [ ] **Step 5: Wire `initOwnerId()` into the app boot**

Modify `src/main.ts` — add the import beside the other `./main/*` imports (after line 14):

```ts
import { initOwnerId } from './main/identity';
```

Inside `app.whenReady().then(async () => { ... })`, add as the FIRST step (before `installPermissionHandlers()`, i.e. immediately after the `async () => {` on line 31):

```ts
  // 0. Device-stable owner_id — the memory spine. Must exist before any turn runs.
  await initOwnerId();
```

- [ ] **Step 6: Verify the app still boots**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/identity.ts src/main/identity.test.ts src/main.ts
git commit -m "feat(memory): device-stable owner_id identity module + boot init"
```

---

### Task 3: Owner-scope the memory store + getProfile/supersede

**Files:**
- Modify: `src/shared/memory.ts`
- Modify: `src/memory/index.ts:21-69` (remember insert + recall RPC), plus new `getProfile`/`supersede`
- Test: `src/memory/index.test.ts`

**Interfaces:**
- Consumes: the RPCs from Task 1 (`get_profile`, `supersede_memory`, `match_memory` with `p_owner_id`).
- Produces (for Tasks 4, 6, 7): types `RememberInput { owner_id; session_id; kind; text; payload? }`, `MemoryRow { id; owner_id; session_id; kind; text; payload; superseded; created_at }`, `MemoryMatch extends MemoryRow { similarity }`, `FactPayload { key; value; source: { session_id; turn_ts } }`; functions `remember(RememberInput)`, `recall({ query; k?; ownerId; sessionId? })`, `getProfile(ownerId: string): Promise<MemoryRow[]>`, `supersede(id: string): Promise<void>`.

- [ ] **Step 1: Update the shared memory contract**

Replace the entire contents of `src/shared/memory.ts`:

```ts
// src/shared/memory.ts — Insforge pgvector memory contract (owner-scoped).
export type MemoryKind = 'action' | 'narration' | 'observation' | 'fact';

export interface RememberInput {
  owner_id: string;
  session_id: string;
  kind: MemoryKind;
  text: string;
  payload?: unknown;
}

export interface MemoryRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  text: string;
  payload: unknown;
  superseded: boolean;
  // Embedding provenance — stamped on write; OPTIONAL because the M1 RPC reads
  // (match_memory/get_profile) do not return it (their RETURNS TABLE stays minimal).
  embed_model?: string;
  embed_dim?: number;
  created_at: string;
}

export interface MemoryMatch extends MemoryRow {
  similarity: number;
}

/** Provenance for a thin profile fact. */
export interface FactSource {
  session_id: string;
  turn_ts: number;
}

/** The structured payload stored on a `kind:'fact'` row. */
export interface FactPayload {
  key: string;
  value: string;
  source: FactSource;
}
```

- [ ] **Step 2: Write the failing test (getProfile + supersede request shapes)**

> We unit-test the two NON-embedding RPC calls (`getProfile`, `supersede`) by stubbing `fetch`. `remember`/`recall` embed first (a dynamic `../brain` import that would hit Nebius), so their `owner_id` threading is enforced by `tsc` + verified live in Task 8 — we do not fake the embedding seam here.

Create `src/memory/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProfile, supersede } from './index';

const OWNER = '11111111-1111-4111-8111-111111111111';

function mockFetchOnce(jsonBody: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, json: async () => jsonBody, text: async () => '' } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const FACT_ROW = {
  id: 'r1', owner_id: OWNER, session_id: 'sess-A', kind: 'fact',
  text: 'writes a test alongside each feature',
  payload: { key: 'tests_with_features', value: 'writes a test alongside each feature', source: { session_id: 'sess-A', turn_ts: 1 } },
  superseded: false, created_at: '2026-06-21T00:00:00Z',
};

describe('memory store owner-scoped RPCs', () => {
  beforeEach(() => {
    process.env.INSFORGE_URL = 'https://insforge.test';
    process.env.INSFORGE_KEY = 'k';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getProfile POSTs get_profile with p_owner_id and returns rows', async () => {
    const calls = mockFetchOnce([FACT_ROW]);
    const rows = await getProfile(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('r1');
    expect(calls[0].url).toBe('https://insforge.test/api/database/rpc/get_profile');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_owner_id: OWNER });
  });

  it('supersede POSTs supersede_memory with p_id', async () => {
    const calls = mockFetchOnce([]);
    await supersede('r1');
    expect(calls[0].url).toBe('https://insforge.test/api/database/rpc/supersede_memory');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_id: 'r1' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/memory/index.test.ts`
Expected: FAIL — `getProfile is not a function` (not yet exported).

- [ ] **Step 4: Implement owner_id threading + getProfile + supersede**

In `src/memory/index.ts`, update the `remember` insert body (the object inside the `body: JSON.stringify([ ... ])` at lines 28-36) to include `owner_id`:

```ts
      {
        owner_id: input.owner_id,
        session_id: input.session_id,
        kind: input.kind,
        text: input.text,
        payload: input.payload ?? null,
        embedding,
        // Provenance stamp: which embedder wrote this vector (existing module consts
        // NEBIUS_EMBEDDING_MODEL + EMBEDDING_DIMENSION). Makes a future re-embed auditable.
        embed_model: NEBIUS_EMBEDDING_MODEL,
        embed_dim: EMBEDDING_DIMENSION,
      },
```

Update the `recall` signature + RPC body (lines 46-62). Replace the function header and the `body`:

```ts
export async function recall(input: {
  query: string;
  k?: number;
  ownerId: string;
  sessionId?: string;
}): Promise<MemoryMatch[]> {
  requireText(input.query, 'recall query');
  requireText(input.ownerId, 'recall ownerId');
  const k = normalizeK(input.k);
  const queryEmbedding = await embedText(input.query);

  const rows = await insforgeFetch<unknown>('/api/database/rpc/match_memory', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      k,
      p_session_id: input.sessionId ?? null,
      p_owner_id: input.ownerId,
    }),
  });
```

Add the two new functions immediately after `recall` (before `embedText`):

```ts
/** Active (non-superseded) profile facts for an owner, newest first. */
export async function getProfile(ownerId: string): Promise<MemoryRow[]> {
  requireText(ownerId, 'getProfile ownerId');
  const rows = await insforgeFetch<unknown>('/api/database/rpc/get_profile', {
    method: 'POST',
    body: JSON.stringify({ p_owner_id: ownerId }),
  });
  if (!Array.isArray(rows) || !rows.every(isMemoryRow)) {
    throw new Error('Insforge get_profile returned an unexpected payload');
  }
  return rows;
}

/** Mark a row superseded (supersede-not-overwrite; also the future "forget" primitive). */
export async function supersede(id: string): Promise<void> {
  requireText(id, 'supersede id');
  await insforgeFetch<unknown>('/api/database/rpc/supersede_memory', {
    method: 'POST',
    body: JSON.stringify({ p_id: id }),
  });
}
```

Update `isMemoryRow` (lines 169-183) to require the two new columns:

```ts
function isMemoryRow(value: unknown): value is MemoryRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.owner_id === 'string' &&
    typeof row.session_id === 'string' &&
    typeof row.kind === 'string' &&
    typeof row.text === 'string' &&
    'payload' in row &&
    typeof row.superseded === 'boolean' &&
    typeof row.created_at === 'string'
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/memory/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files that call `recall(...)` / `remember(...)` without the new fields (the orchestrator + ipc handlers). These are fixed in Task 7 — confirm the errors are confined to `src/main/orchestrator.ts` and `src/main/ipc.ts`, then proceed.

- [ ] **Step 7: Commit**

```bash
git add src/shared/memory.ts src/memory/index.ts src/memory/index.test.ts
git commit -m "feat(memory): owner-scope remember/recall + getProfile/supersede RPCs"
```

---

### Task 4: Labeled recall composition + the cross-launch recall path

**Files:**
- Create: `src/main/memoryContext.ts`
- Test: `src/main/memoryContext.test.ts`

**Interfaces:**
- Consumes: `MemoryRow`, `MemoryMatch` (Task 3).
- Produces (for Task 7): `composeMemoryContext(facts: MemoryRow[], episodes: MemoryMatch[]): string | undefined`; `RecallDeps` (`getProfile` + `recall`); `buildRecallContext(deps: RecallDeps, opts: { ownerId; sessionId; query; k?; minSimilarity? }): Promise<{ context: string | undefined; factCount: number; episodeCount: number }>`.

- [ ] **Step 1: Write the failing test**

Create `src/main/memoryContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeMemoryContext, buildRecallContext, type RecallDeps } from './memoryContext';
import type { MemoryRow, MemoryMatch } from '../shared/memory';

const OWNER = 'owner-A';
function factRow(text: string, over: Partial<MemoryRow> = {}): MemoryRow {
  return { id: 'f', owner_id: OWNER, session_id: 's', kind: 'fact', text, payload: {}, superseded: false, created_at: '2026-06-21T00:00:00Z', ...over };
}
function match(text: string, similarity: number): MemoryMatch {
  return { ...factRow(text), kind: 'observation', similarity };
}

describe('composeMemoryContext', () => {
  it('labels facts separately from episodes', () => {
    const ctx = composeMemoryContext([factRow('writes a test alongside each feature')], [match('user asked to add a login route', 0.7)]);
    expect(ctx).toContain('KNOWN ABOUT THIS USER:');
    expect(ctx).toContain('- writes a test alongside each feature');
    expect(ctx).toContain('RELATED PAST CONTEXT:');
    expect(ctx).toContain('- user asked to add a login route');
    // facts segment must come before episodes so truncation never drops them first
    expect(ctx!.indexOf('KNOWN ABOUT THIS USER')).toBeLessThan(ctx!.indexOf('RELATED PAST CONTEXT'));
  });
  it('returns undefined when there is nothing to say', () => {
    expect(composeMemoryContext([], [])).toBeUndefined();
  });
  it('emits only the facts section when there are no episodes', () => {
    const ctx = composeMemoryContext([factRow('prefers Zustand')], []);
    expect(ctx).toContain('KNOWN ABOUT THIS USER:');
    expect(ctx).not.toContain('RELATED PAST CONTEXT:');
  });
});

describe('buildRecallContext (cross-launch: facts survive a session change)', () => {
  // An in-memory fake honoring owner-scoping + the similarity floor — the contract the live SQL implements.
  function fakeDeps(store: { profile: MemoryRow[]; matches: MemoryMatch[] }): RecallDeps {
    return {
      getProfile: async (ownerId) => store.profile.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded),
      recall: async ({ ownerId }) => store.matches.filter((m) => m.owner_id === ownerId),
    };
  }

  it('surfaces a prior-session fact in a NEW session', async () => {
    const deps = fakeDeps({
      profile: [factRow('writes a test alongside each feature', { session_id: 'launch-A' })],
      matches: [match('add a logout route', 0.6)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('writes a test alongside each feature');
  });

  it('drops episodes below the similarity floor but keeps facts', async () => {
    const deps = fakeDeps({
      profile: [factRow('prefers Zustand', { session_id: 'launch-A' })],
      matches: [match('irrelevant', 0.1)],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'state mgmt', minSimilarity: 0.3 });
    expect(out.episodeCount).toBe(0);
    expect(out.context).toContain('prefers Zustand');
  });

  it('does NOT leak another owner\'s facts', async () => {
    const deps = fakeDeps({
      profile: [factRow('secret', { owner_id: 'someone-else', session_id: 'x' })],
      matches: [],
    });
    const out = await buildRecallContext(deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'anything' });
    expect(out.factCount).toBe(0);
    expect(out.context).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/memoryContext.test.ts`
Expected: FAIL — `Cannot find module './memoryContext'`.

- [ ] **Step 3: Implement the module**

Create `src/main/memoryContext.ts`:

```ts
// src/main/memoryContext.ts — compose recall into a LABELED memory string for DecideInput.memory.
// Facts (the durable "knows-you" segment) come first so truncation never drops them before episodes.
import type { MemoryRow, MemoryMatch } from '../shared/memory';

export interface RecallDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  recall(input: { query: string; k?: number; ownerId: string; sessionId?: string }): Promise<MemoryMatch[]>;
}

export function composeMemoryContext(facts: MemoryRow[], episodes: MemoryMatch[]): string | undefined {
  const sections: string[] = [];
  if (facts.length > 0) {
    sections.push(['KNOWN ABOUT THIS USER:', ...facts.map((f) => `- ${f.text}`)].join('\n'));
  }
  if (episodes.length > 0) {
    sections.push(['RELATED PAST CONTEXT:', ...episodes.map((e) => `- ${e.text}`)].join('\n'));
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export async function buildRecallContext(
  deps: RecallDeps,
  opts: { ownerId: string; sessionId: string; query: string; k?: number; minSimilarity?: number },
): Promise<{ context: string | undefined; factCount: number; episodeCount: number }> {
  const minSimilarity = opts.minSimilarity ?? 0.3;
  const [facts, matches] = await Promise.all([
    deps.getProfile(opts.ownerId),
    deps.recall({ query: opts.query, k: opts.k, ownerId: opts.ownerId, sessionId: opts.sessionId }),
  ]);
  const episodes = matches.filter((m) => m.similarity > minSimilarity);
  return {
    context: composeMemoryContext(facts, episodes),
    factCount: facts.length,
    episodeCount: episodes.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/memoryContext.test.ts`
Expected: PASS (6 tests, including the three cross-launch cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/memoryContext.ts src/main/memoryContext.test.ts
git commit -m "feat(memory): labeled recall composition + cross-launch recall path"
```

---

### Task 5: The thin 1-fact-per-turn extractor (brain side)

**Files:**
- Create: `src/brain/extractFact.ts` (pure prompt builder + parser)
- Modify: `src/brain/index.ts` (the Nebius caller)
- Test: `src/brain/extractFact.test.ts`

**Interfaces:**
- Consumes: the Nebius client in `src/brain/index.ts` (`getNebiusClient`, `getModelIds`).
- Produces (for Tasks 6, 7): `FactExtractInput { transcript; narration; task?; outcome: 'completed' | 'failed' | 'answered' }`; `FactCandidate { key: string; value: string }`; `buildFactPrompt(input): string`; `parseFactResponse(raw: string): FactCandidate | null`; and `extractFact(input: FactExtractInput): Promise<FactCandidate | null>` exported from `src/brain/index.ts`.

- [ ] **Step 1: Write the failing test (the pure parser — the part that must be conservative)**

Create `src/brain/extractFact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFactPrompt, parseFactResponse } from './extractFact';

describe('parseFactResponse (null-when-unsure)', () => {
  it('returns a candidate for a well-formed fact', () => {
    const out = parseFactResponse('{"key":"tests_with_features","value":"writes a test alongside each feature"}');
    expect(out).toEqual({ key: 'tests_with_features', value: 'writes a test alongside each feature' });
  });
  it('tolerates code fences', () => {
    const out = parseFactResponse('```json\n{"key":"pkg_manager","value":"uses pnpm"}\n```');
    expect(out).toEqual({ key: 'pkg_manager', value: 'uses pnpm' });
  });
  it('returns null for the literal null sentinel', () => {
    expect(parseFactResponse('null')).toBeNull();
    expect(parseFactResponse('{"key":null,"value":null}')).toBeNull();
  });
  it('returns null for garbage / empty / missing fields (never throws)', () => {
    expect(parseFactResponse('')).toBeNull();
    expect(parseFactResponse('not json')).toBeNull();
    expect(parseFactResponse('{"key":"x"}')).toBeNull();
    expect(parseFactResponse('{"value":"y"}')).toBeNull();
    expect(parseFactResponse('{"key":"","value":"  "}')).toBeNull();
  });
});

describe('buildFactPrompt', () => {
  it('includes the transcript and demands a single fact or null', () => {
    const p = buildFactPrompt({ transcript: 'use pnpm not npm', narration: 'ok', outcome: 'answered' });
    expect(p).toContain('use pnpm not npm');
    expect(p.toLowerCase()).toContain('null');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/brain/extractFact.test.ts`
Expected: FAIL — `Cannot find module './extractFact'`.

- [ ] **Step 3: Implement the pure module**

Create `src/brain/extractFact.ts`:

```ts
// src/brain/extractFact.ts — pure prompt + parser for the thin 1-fact-per-turn extractor.
// CONSERVATIVE BY DESIGN: any doubt -> null (write no row). A silent cat beats a wrong one.

export interface FactExtractInput {
  transcript: string;
  narration: string;
  task?: string;
  outcome: 'completed' | 'failed' | 'answered';
}

export interface FactCandidate {
  key: string;
  value: string;
}

export const FACT_SYSTEM_PROMPT =
  `You extract AT MOST ONE durable, reusable fact about how this developer likes to work — ` +
  `a stable preference, convention, tool choice, or project fact worth remembering across sessions. ` +
  `Ignore one-off task details. If there is no durable fact, or you are at all unsure, output exactly null.\n` +
  `Output ONLY one JSON object {"key": string, "value": string} (snake_case key, short human-readable value), or the literal null.`;

export function buildFactPrompt(input: FactExtractInput): string {
  return [
    `OUTCOME: ${input.outcome}`,
    `USER SAID: ${JSON.stringify(input.transcript)}`,
    input.task ? `TASK: ${JSON.stringify(input.task)}` : '',
    `NERO SAID: ${JSON.stringify(input.narration)}`,
    `Extract one durable fact as {"key","value"}, or output null if there is no durable fact or you are unsure.`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

export function parseFactResponse(raw: string): FactCandidate | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (/^null$/i.test(withoutFence)) return null;

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const key = (parsed as Record<string, unknown>).key;
  const value = (parsed as Record<string, unknown>).value;
  if (typeof key !== 'string' || typeof value !== 'string') return null;
  const k = key.trim();
  const v = value.trim();
  if (!k || !v) return null;
  return { key: k, value: v };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/brain/extractFact.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the Nebius caller to the brain**

In `src/brain/index.ts`, add the import at the top (after line 3):

```ts
import { buildFactPrompt, parseFactResponse, FACT_SYSTEM_PROMPT, type FactExtractInput, type FactCandidate } from './extractFact';
```

Re-export the types (after line 7):

```ts
export type { FactExtractInput, FactCandidate } from './extractFact';
```

Add the caller (after the `decide` function, before `describeScreen`, i.e. after line 140):

```ts
/**
 * Thin 1-fact-per-turn extractor. Cheap, non-streaming, OFF the critical path.
 * Returns at most one durable fact, or null when there is nothing worth remembering.
 */
export async function extractFact(input: FactExtractInput): Promise<FactCandidate | null> {
  const models = getModelIds();
  const response = await getNebiusClient().chat.completions.create({
    model: models.reason,
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACT_SYSTEM_PROMPT },
      { role: 'user', content: buildFactPrompt(input) },
    ],
  });
  const content = response.choices[0]?.message?.content;
  return typeof content === 'string' ? parseFactResponse(content) : null;
}
```

> Note: `response_format: { type: 'json_object' }` can refuse the bare `null` token on some providers; `parseFactResponse` already treats a `{"key":null,"value":null}` object as null, so the conservative path holds either way.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: same confined orchestrator/ipc errors as Task 3 Step 6 (still unfixed until Task 7); no new errors in `src/brain/`.

- [ ] **Step 7: Commit**

```bash
git add src/brain/extractFact.ts src/brain/extractFact.test.ts src/brain/index.ts
git commit -m "feat(memory): thin 1-fact-per-turn extractor (conservative, null-when-unsure)"
```

---

### Task 6: Fact store — supersede-not-overwrite

**Files:**
- Create: `src/main/factStore.ts`
- Test: `src/main/factStore.test.ts`

**Interfaces:**
- Consumes: `FactCandidate` (Task 5); `RememberInput`, `MemoryRow`, `FactPayload` (Task 3).
- Produces (for Task 7): `FactStoreDeps` (`getProfile`, `remember`, `supersede`); `extractAndStoreFact(deps: FactStoreDeps, candidate: FactCandidate | null, ctx: { ownerId; sessionId; turnTs }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/main/factStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import type { MemoryRow, RememberInput, FactPayload } from '../shared/memory';

function factRow(id: string, key: string, value: string): MemoryRow {
  const payload: FactPayload = { key, value, source: { session_id: 'old', turn_ts: 0 } };
  return { id, owner_id: 'O', session_id: 'old', kind: 'fact', text: value, payload, superseded: false, created_at: '2026-06-21T00:00:00Z' };
}

function fakeDeps(seed: MemoryRow[]) {
  const inserts: RememberInput[] = [];
  const superseded: string[] = [];
  const deps: FactStoreDeps = {
    getProfile: async () => seed.filter((r) => !superseded.includes(r.id)),
    remember: async (input) => { inserts.push(input); return { ...factRow('new', 'k', 'v'), ...input } as unknown as MemoryRow; },
    supersede: async (id) => { superseded.push(id); },
  };
  return { deps, inserts, superseded };
}

const CTX = { ownerId: 'O', sessionId: 'sess-B', turnTs: 1718900000000 };

describe('extractAndStoreFact', () => {
  it('writes nothing when the candidate is null', async () => {
    const { deps, inserts } = fakeDeps([]);
    await extractAndStoreFact(deps, null, CTX);
    expect(inserts).toHaveLength(0);
  });

  it('inserts a new source-linked fact when none exists for the key', async () => {
    const { deps, inserts, superseded } = fakeDeps([]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ owner_id: 'O', session_id: 'sess-B', kind: 'fact', text: 'uses pnpm' });
    expect(inserts[0].payload).toEqual({ key: 'pkg_manager', value: 'uses pnpm', source: { session_id: 'sess-B', turn_ts: CTX.turnTs } });
  });

  it('supersedes the old row then inserts when the value changes', async () => {
    const { deps, inserts, superseded } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses npm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toEqual(['r-old']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].text).toBe('uses pnpm');
  });

  it('is a no-op when the same key already has the same value', async () => {
    const { deps, inserts, superseded } = fakeDeps([factRow('r-old', 'pkg_manager', 'uses pnpm')]);
    await extractAndStoreFact(deps, { key: 'pkg_manager', value: 'uses pnpm' }, CTX);
    expect(superseded).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/factStore.test.ts`
Expected: FAIL — `Cannot find module './factStore'`.

- [ ] **Step 3: Implement the module**

Create `src/main/factStore.ts`:

```ts
// src/main/factStore.ts — write a thin profile fact with supersede-not-overwrite.
// Pure of the LLM (the caller passes a FactCandidate); trivially testable with fakes.
import type { MemoryRow, RememberInput, FactPayload } from '../shared/memory';
import type { FactCandidate } from '../brain/extractFact';

export interface FactStoreDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  remember(input: RememberInput): Promise<MemoryRow>;
  supersede(id: string): Promise<void>;
}

function factKeyOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.key === 'string' ? p.key : undefined;
}

function factValueOf(row: MemoryRow): string | undefined {
  const p = row.payload as Partial<FactPayload> | null;
  return p && typeof p === 'object' && typeof p.value === 'string' ? p.value : undefined;
}

/**
 * Store one extracted fact. null -> no write. Same key + same value -> no-op. Same key +
 * changed value -> mark the prior row superseded, then insert the new one (append-only history).
 */
export async function extractAndStoreFact(
  deps: FactStoreDeps,
  candidate: FactCandidate | null,
  ctx: { ownerId: string; sessionId: string; turnTs: number },
): Promise<void> {
  if (!candidate) return;

  const existing = (await deps.getProfile(ctx.ownerId)).find((r) => factKeyOf(r) === candidate.key);
  if (existing) {
    if (factValueOf(existing) === candidate.value) return; // unchanged
    await deps.supersede(existing.id);
  }

  const payload: FactPayload = {
    key: candidate.key,
    value: candidate.value,
    source: { session_id: ctx.sessionId, turn_ts: ctx.turnTs },
  };
  await deps.remember({
    owner_id: ctx.ownerId,
    session_id: ctx.sessionId,
    kind: 'fact',
    text: candidate.value,
    payload,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/factStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/factStore.ts src/main/factStore.test.ts
git commit -m "feat(memory): factStore with supersede-not-overwrite"
```

---

### Task 7: Wire it into the orchestrator + the cross-launch fixture (the proof)

**Files:**
- Modify: `src/main/siblings.ts:46-49` (MemoryModule) and `:39-44` (BrainModule)
- Modify: `src/main/orchestrator.ts` (recall composition + owner_id on every remember + post-terminal extraction)
- Modify: `src/main/ipc.ts:96-112` (inject owner_id into the memory handlers)
- Test: `src/main/memorySpine.crosslaunch.test.ts`

**Interfaces:**
- Consumes: `getOwnerId` (Task 2), `buildRecallContext` (Task 4), `extractFact` (Task 5), `extractAndStoreFact` (Task 6), the extended `MemoryModule`/`BrainModule` (this task).
- Produces: the live owner-scoped turn loop; the canonical teach→recall fixture.

- [ ] **Step 1: Write the failing fixture (the teach→recall proof across a session change)**

Create `src/main/memorySpine.crosslaunch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractAndStoreFact, type FactStoreDeps } from './factStore';
import { buildRecallContext, type RecallDeps } from './memoryContext';
import type { MemoryRow, MemoryMatch, RememberInput, FactPayload } from '../shared/memory';

// One in-memory store implementing the SAME owner-scoped, superseded-aware contract the live SQL must.
function makeStore() {
  const rows: MemoryRow[] = [];
  let n = 0;
  const remember = async (input: RememberInput): Promise<MemoryRow> => {
    const row: MemoryRow = { id: `id-${n++}`, owner_id: input.owner_id, session_id: input.session_id, kind: input.kind, text: input.text, payload: input.payload ?? null, superseded: false, created_at: new Date(n).toISOString() };
    rows.push(row);
    return row;
  };
  const getProfile = async (ownerId: string) => rows.filter((r) => r.owner_id === ownerId && r.kind === 'fact' && !r.superseded);
  const supersede = async (id: string) => { const r = rows.find((x) => x.id === id); if (r) r.superseded = true; };
  // recall: naive substring match scoped to owner (stands in for pgvector cosine + owner filter).
  const recall = async ({ query, ownerId }: { query: string; ownerId: string; k?: number; sessionId?: string }): Promise<MemoryMatch[]> =>
    rows.filter((r) => r.owner_id === ownerId && r.kind !== 'fact' && query.split(' ').some((w) => r.text.includes(w))).map((r) => ({ ...r, similarity: 0.9 }));
  return { rows, deps: { getProfile, remember, supersede } as FactStoreDeps & RecallDeps };
}

const OWNER = 'owner-A';

describe('MEMORY SPINE — cross-launch teach→recall (the magic moment, headless)', () => {
  it('a fact taught in launch A is recalled in launch B (fresh session, same owner)', async () => {
    const store = makeStore();

    // --- Launch A: a turn teaches one durable fact ---
    await extractAndStoreFact(store.deps, { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });

    // --- Launch B: brand-new session id, SAME owner, app restarted ---
    const out = await buildRecallContext(store.deps, { ownerId: OWNER, sessionId: 'launch-B', query: 'add a logout route', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('KNOWN ABOUT THIS USER:');
    expect(out.context).toContain('writes a test alongside each feature');

    // The taught fact carries provenance.
    const fact = store.rows.find((r) => r.kind === 'fact')!;
    expect((fact.payload as FactPayload).source).toEqual({ session_id: 'launch-A', turn_ts: 1 });
  });

  it('a later correction supersedes the old fact (no stale value resurfaces)', async () => {
    const store = makeStore();
    await extractAndStoreFact(store.deps, { key: 'pkg_manager', value: 'uses npm' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    await extractAndStoreFact(store.deps, { key: 'pkg_manager', value: 'uses pnpm' }, { ownerId: OWNER, sessionId: 'launch-B', turnTs: 2 });

    const out = await buildRecallContext(store.deps, { ownerId: OWNER, sessionId: 'launch-C', query: 'install deps', minSimilarity: 0.3 });
    expect(out.factCount).toBe(1);
    expect(out.context).toContain('uses pnpm');
    expect(out.context).not.toContain('uses npm');
  });

  it('another owner on the same machine sees none of it', async () => {
    const store = makeStore();
    await extractAndStoreFact(store.deps, { key: 'tests_with_features', value: 'writes a test alongside each feature' }, { ownerId: OWNER, sessionId: 'launch-A', turnTs: 1 });
    const out = await buildRecallContext(store.deps, { ownerId: 'owner-B', sessionId: 'x', query: 'add a logout route' });
    expect(out.factCount).toBe(0);
    expect(out.context).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the fixture to verify it fails**

Run: `npx vitest run src/main/memorySpine.crosslaunch.test.ts`
Expected: PASS already (it only depends on Tasks 4 + 6, which exist). If it PASSES, that is correct — this fixture is the regression net; proceed to wire the live orchestrator so the real path uses these modules. (If Tasks 4/6 were skipped it would fail with a missing-module error.)

- [ ] **Step 3: Extend the sibling interfaces**

In `src/main/siblings.ts`, update `MemoryModule` (lines 46-49):

```ts
export interface MemoryModule {
  remember(input: RememberInput): Promise<MemoryRow>;
  recall(input: { query: string; k?: number; ownerId: string; sessionId?: string }): Promise<MemoryMatch[]>;
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  supersede(id: string): Promise<void>;
}
```

Update `BrainModule` (lines 39-44) — add the extractor and the import. First extend the import at line 29:

```ts
import type { Decision, DecideInput } from '../shared/brain';
import type { FactExtractInput, FactCandidate } from '../brain/extractFact';
```

Then add to `BrainModule`:

```ts
  extractFact(input: FactExtractInput): Promise<FactCandidate | null>;
```

- [ ] **Step 4: Rewire the orchestrator**

In `src/main/orchestrator.ts`, add imports (after line 24):

```ts
import { getOwnerId } from './identity';
import { buildRecallContext } from './memoryContext';
import { extractAndStoreFact } from './factStore';
import type { FactExtractInput } from '../brain/extractFact';
```

Replace `recallContext` (lines 146-173) with the owner-scoped version:

```ts
async function recallContext(
  query: string,
  sessionId: string,
  runId: string,
): Promise<string | undefined> {
  try {
    const memory = await loadMemory();
    const { context, factCount, episodeCount } = await buildRecallContext(memory, {
      ownerId: getOwnerId(),
      sessionId,
      query,
      k: RECALL_K,
      minSimilarity: RECALL_MIN_SIMILARITY,
    });
    // Visible memory beat (stays kind:'message' in A.5; migrates to kind:'status' in C1).
    pushEvent({
      kind: 'message',
      runId,
      text: `Insforge memory: ${factCount} known ${factCount === 1 ? 'fact' : 'facts'}, ${episodeCount} related ${episodeCount === 1 ? 'item' : 'items'}`,
      ts: Date.now(),
    });
    return context;
  } catch (err) {
    console.error('[orchestrator] recall failed:', (err as Error).message);
    return undefined;
  }
}
```

Add `owner_id: getOwnerId()` to the three `remember` calls — in `rememberEvent` (line 129), `rememberNarration` (line 379), and `rememberUserSaid` (line 394). Each `memory.remember({ ... })` gains `owner_id: getOwnerId(),` as the first field. Example for `rememberUserSaid`:

```ts
    await memory.remember({
      owner_id: getOwnerId(),
      session_id: sessionId,
      kind: 'observation',
      text: transcript,
    });
```

(Apply the identical `owner_id: getOwnerId(),` addition to the `remember` objects in `rememberEvent` and `rememberNarration`.)

Add the post-terminal extraction helper (after `rememberUserSaid`, near line 402):

```ts
/**
 * Off-critical-path: after a turn's terminal event, extract AT MOST one durable fact and
 * store it (supersede-not-overwrite). Fire-and-forget; never blocks or fails a turn.
 */
async function runFactExtraction(
  sessionId: string,
  input: Omit<FactExtractInput, 'outcome'> & { outcome: FactExtractInput['outcome'] },
): Promise<void> {
  try {
    const [brain, memory] = await Promise.all([loadBrain(), loadMemory()]);
    const candidate = await brain.extractFact(input);
    await extractAndStoreFact(memory, candidate, {
      ownerId: getOwnerId(),
      sessionId,
      turnTs: Date.now(),
    });
  } catch (err) {
    console.error('[orchestrator] fact extraction failed:', (err as Error).message);
  }
}
```

Fire it from `actOnDecision`. In the `answer`/`clarify` branch (lines 308-314), before `pushRunEnd(runId)`:

```ts
      emitNarration(runId, decision.narration);
      void runFactExtraction(sessionId, { transcript, narration: decision.narration, outcome: 'answered' });
      pushRunEnd(runId);
      return;
```

For `run_agent`, thread the fact context into `dispatchExecutor` so extraction fires on the terminal event (this survives the Phase-B dispatch-return change). Change the `dispatchExecutor` signature (line 193) and its terminal handling:

```ts
async function dispatchExecutor(
  runId: string,
  sessionId: string,
  prompt: string,
  agent: AgentKind,
  factCtx?: { transcript: string; narration: string; task: string },
): Promise<void> {
```

Inside the `for await` terminal block (lines 213-216), after `notifyJobDone(...)`, add the fire-and-forget extraction:

```ts
      if (ev.kind === 'run.completed' || ev.kind === 'run.failed') {
        terminalSeen = true;
        notifyJobDone(ev.kind === 'run.completed', terminalEventText(ev));
        if (factCtx) {
          void runFactExtraction(sessionId, {
            transcript: factCtx.transcript,
            narration: factCtx.narration,
            task: factCtx.task,
            outcome: ev.kind === 'run.completed' ? 'completed' : 'failed',
          });
        }
      }
```

And update the `run_agent` call site (lines 360-370) to pass `factCtx`:

```ts
    case 'run_agent': {
      if (decision.narration) emitNarration(runId, decision.narration);
      const task =
        typeof decision.args.task === 'string' ? decision.args.task : transcript;
      const agent: AgentKind =
        decision.args.agent === 'claude' ? 'claude' : DEFAULT_AGENT;
      await dispatchExecutor(runId, sessionId, task, agent, {
        transcript,
        narration: decision.narration,
        task,
      });
      return;
    }
```

(The synthetic `run.completed` fallback path at lines 220-231 does not fire extraction — it only triggers when no terminal event was seen, an abnormal case; skipping a fact there is correct.)

- [ ] **Step 5: Inject owner_id into the renderer-facing memory handlers**

In `src/main/ipc.ts`, add the import (after line 28):

```ts
import { getOwnerId } from './identity';
```

Update the two memory handlers (lines 96-112) so the renderer never supplies `owner_id`:

```ts
  // ---- Memory (sibling: src/memory) — owner_id is injected MAIN-side, never trusted from renderer ----
  ipcMain.handle(
    CH.memoryRemember,
    async (_e, input: Omit<RememberInput, 'owner_id'>): Promise<MemoryRow> => {
      const memory = await loadMemory();
      return memory.remember({ ...input, owner_id: getOwnerId() });
    },
  );
  ipcMain.handle(
    CH.memoryRecall,
    async (
      _e,
      input: { query: string; k?: number; sessionId?: string },
    ): Promise<MemoryMatch[]> => {
      const memory = await loadMemory();
      return memory.recall({ ...input, ownerId: getOwnerId() });
    },
  );
```

- [ ] **Step 6: Typecheck — the orchestrator/ipc errors from Tasks 3 & 5 must now be gone**

Run: `npx tsc --noEmit`
Expected: NO errors (the owner_id threading + extended interfaces resolve every prior error).

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all A.5 tests (identity, memory RPCs, memoryContext, extractFact, factStore, cross-launch fixture) plus the pre-existing Phase-A tests (framePolicy, activity, gaze) green.

- [ ] **Step 8: Commit**

```bash
git add src/main/siblings.ts src/main/orchestrator.ts src/main/ipc.ts src/main/memorySpine.crosslaunch.test.ts
git commit -m "feat(memory): owner-scoped turn loop + post-turn fact extraction + cross-launch fixture"
```

---

### Task 8: Apply the migration + live end-to-end verification

**Files:**
- Reference: `db/migrations/2026-06-21-owner-id.sql` (Task 1)
- No code changes — this task applies the schema and verifies the real magic moment on a live build.

**Interfaces:**
- Consumes: everything above, against the real Insforge project.

- [ ] **Step 1: Confirm the live `match_memory` signature, then apply the migration**

In the Insforge project's SQL editor, run `\df match_memory` (or inspect the function) to confirm its exact argument types, and confirm the `memory` embedding column is `vector(1536)`. Adjust the `drop function if exists match_memory(...)` line in the migration to match, then execute `db/migrations/2026-06-21-owner-id.sql`.

- [ ] **Step 2: Smoke the RPCs directly**

```bash
# get_profile for a not-yet-seen owner returns [] (not an error):
curl -sS -X POST "$INSFORGE_URL/api/database/rpc/get_profile" \
  -H "Content-Type: application/json" -H "x-api-key: $INSFORGE_KEY" \
  -d '{"p_owner_id":"00000000-0000-4000-8000-000000000000"}'
# Expected: []
```

Expected: `[]` (empty array, HTTP 200) — proves the function exists and is owner-filtered.

- [ ] **Step 3: Live cross-launch test (the actual magic moment)**

1. `npm start` (or `COMPANION_FLOATING_WINDOW=1 npm start`). Note the minted owner_id: `cat "$(node -e "console.log(require('electron').app?.getPath?.('userData')||'')" 2>/dev/null)"/owner.json` — or read it from the app's userData dir.
2. Run a turn that teaches a preference (type into the console prompt, or speak): e.g. *"from now on always write a test alongside any feature you add"*. Let the turn finish.
3. **Fully quit** the app (Cmd+Q).
4. `npm start` again. Confirm `owner.json` is unchanged (same id).
5. Run a new turn: *"add a logout route"*. 
6. **Verify:** the brain's `RELEVANT MEMORY` now contains a `KNOWN ABOUT THIS USER:` line with the taught fact, and the narration reflects it. Confirm via the console timeline / the `Insforge memory: N known facts` beat showing `1 known fact`.

- [ ] **Step 4: Verify owner isolation + no idle cost**

Confirm in the Insforge `memory` table that the `fact` row has a non-null `owner_id`, a `payload.source.session_id` matching launch A, and a non-null provenance stamp (`embed_model = 'Qwen/Qwen3-Embedding-8B'`, `embed_dim = 1536`). Confirm idle behavior is unchanged (no new always-on timers were added — extraction is event-gated).

- [ ] **Step 5: Mark A.5 done**

A.5 is complete when: `npx tsc --noEmit` clean, `npx vitest run` green, the migration is applied, and the live cross-launch test surfaces the prior-session fact. Phase B (floating Ask/Stop + `turnRun` resolves at dispatch) builds on this.

```bash
git commit --allow-empty -m "chore(memory): A.5 memory spine verified live (cross-launch recall works)"
```

---

## Self-Review

**1. Spec coverage** (against the v2 spine §Pillar IV + Phase A.5 row + the founder amendment):
- Mint device-stable `owner_id` (atomic, loud-fail) → Task 2. ✓
- SQL migration (`owner_id` + `match_memory` `p_owner_id`, keep `p_session_id`) → Task 1. ✓
- Rescope recall session→owner → Task 3 (recall) + Task 7 (orchestrator). ✓
- `getProfile()` of fact rows → Task 3. ✓
- Thin 1-fact/turn extractor, null-when-unsure → Task 5. ✓
- Source-linked facts (`payload.source`) → Task 6 + asserted in Task 7 fixture. ✓
- Supersede-not-overwrite (`superseded` column + flow) → Task 1 + Task 6. ✓
- Labeled facts segment into `DecideInput.memory`, no contract change → Task 4 + Task 7. ✓
- Cross-launch fixture (launch-A write → launch-B recall) → Task 7. ✓ Live proof → Task 8. ✓
- **Carve-out (NOT in this plan, per scope):** the codex-binary PATH resolution + `COMPANION_WORKDIR` first-run prompt ("ship-ability") from the spec's A.5 row — tracked as a separate small follow-up so this plan stays the memory spine. **Noted, not a gap.**

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertion and the run command + expected output.

**3. Type consistency:** `RememberInput`/`MemoryRow`/`MemoryMatch` (owner_id + superseded) defined in Task 3 and consumed identically in Tasks 4/6/7. `recall({ ..., ownerId, sessionId? })` shape identical in memory/index (Task 3), siblings `MemoryModule` (Task 7), `RecallDeps` (Task 4). `FactCandidate`/`FactExtractInput` defined in Task 5, consumed in Tasks 6/7. `FactPayload { key, value, source }` defined in Task 3, written in Task 6, asserted in Task 7. `getProfile(ownerId)`/`supersede(id)` names identical across Tasks 3/4/6/7. ✓
