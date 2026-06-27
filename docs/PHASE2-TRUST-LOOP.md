# Roro Phase 2 Trust Loop

> Build contract for making remembered facts correctable, verifiable, and inspectable without weakening Roro's local-first memory architecture.

## Decision

Expose memory correction as a MAIN-owned trust loop in the existing Memory panel:

- See what Roro remembers.
- Fix a wrong fact.
- Verify a correct fact.
- Inspect safe source metadata.
- Forget a fact deliberately.

Reason: the moat is not "the model guessed a preference once." The moat is user-confirmed, owner-scoped, encrypted local memory that improves because the user can correct it. Correction must be structural, not prompt-dependent.

Evidence: `factStore` already reinforces exact same key/value and replaces changed values through `replaceFact`; `memory2` already has files-as-truth, owner-scoped active facts, confidence, hard forget, WAL-style replace, and reindex/reopen durability. The first correction slice now exposes `profile()`, `fixFact(id,value)`, `verifyFact(id)`, `factSource(id)`, and `forget(id)` through MAIN-owned IPC.

Rejected: do not ask the user to say "actually, remember X" and hope extraction fixes the row. Do not let the renderer write `kind: 'fact'`, supply an owner id, or supply a trusted fact key. Do not implement correction as forget-then-add.

Gate: a stale or wrong-owner fact id cannot mutate memory; a failed replacement leaves the old fact active; fixed/forgotten facts stay fixed/forgotten after reindex/reopen; renderer actions are retryable and render all user-authored text with `textContent`.

## Current Flow

1. `orchestrator.runTurn` builds recall context from profile facts plus episodic recall before storing the current transcript.
2. The user transcript is stored as an episode.
3. The brain decides and either answers, clarifies, captures the screen once, or dispatches an executor.
4. `runFactExtraction` derives at most one `FactCandidate`.
5. `extractAndStoreFact` serializes writes:
   - no candidate -> `noop`
   - same key + same value -> `reinforceFact`
   - new key or changed value -> `replaceFact`
6. The renderer can currently call:
   - `window.memory.profile()`
   - `window.memory.fixFact(id, value)`
   - `window.memory.verifyFact(id)`
   - `window.memory.factSource(id)`
   - `window.memory.forget(id)`

Correction, clarify, README trust framing, and the bounded first screen-capture
tell are now landed. No new storage primitives remain for Phase 2.

## Minimal API

Keep all mutation behind MAIN IPC. The renderer never supplies `ownerId` and never supplies a trusted fact key.

### Renderer-Safe Fact View

Add a view type instead of leaking raw store entries:

```ts
interface ProfileFactView {
  id: string;
  key: string;
  value: string;
  text: string;
  confidence?: number;
  created_at: string;
  source?: {
    session_id?: string;
    turn_ts?: number;
  };
}
```

`memory:profile` returns this view. Raw `MemoryRow` payloads stay out of the renderer panel.

### Fix

```ts
memory.fixFact(id: string, value: string): Promise<ProfileFactView>
```

Implemented flow:

1. Load active profile facts for `getOwnerId()`.
2. Find the active fact by `id`; if missing, throw a user-actionable stale-row error.
3. Read the existing `key` from the active fact payload.
4. Call `replaceFact({ owner_id, key, text: value, payload: { key, value, source } })`.
5. Return the refreshed fact view.

Do not support key editing in the first slice. If key editing becomes necessary, add one atomic store method that supersedes the current id plus active facts for the new key in one WAL operation.

### Verify

```ts
memory.verifyFact(id: string): Promise<ProfileFactView>
```

Implemented flow:

1. Load active profile facts for `getOwnerId()`.
2. Find the active fact by `id`.
3. Read its `key` from payload.
4. Call `reinforceFact({ owner_id, key })`.
5. Return the refreshed fact view.

Verification is a user-confirmed confidence bump, not a new fact.

### Source

```ts
memory.factSource(id: string): Promise<{
  id: string;
  source?: { session_id?: string; turn_ts?: number };
}>
```

Start with safe local provenance only. Do not dump raw transcripts into the renderer until there is a deliberate local-only source viewer with its own privacy copy. The first slice shows session/time metadata and explicitly says no transcript is shown.

### Forget

Keep existing `memory.forget(id)`. Forget is deletion, not ordinary correction. It stays two-step in the UI.

## UI Placement

Evolve `src/renderer/memory/forgetPanel.ts` into the Memory panel in place. Do not add correction to first-run onboarding and do not add another top banner.

Implemented row actions:

- `Fix`: inline input, Save, Cancel.
- `Looks right`: one-click confidence confirmation with retryable failure state.
- `Source`: small provenance popover/expansion with session/time metadata.
- `Forget`: existing two-step irreversible delete.

Keep the existing good behaviors:

- refetch on open; update the changed row from the returned fact after mutation
- render user-authored text with `textContent`
- destructive actions require confirmation
- failed actions keep the row and expose a retryable state

Accessibility status:

- Implemented: `aria-expanded` and `aria-controls` on the Memory toggle and Source disclosure; region/heading semantics for the panel; Escape closes edit mode and source detail; focus restores after panel close, save, cancel, and forget; visible `:focus-visible` styles for Memory actions.

## Tests

Implemented gates:

- `memory2/profileFacts.test.ts`: safe projection, snake/camel source tolerance, owner-scoped fix/verify/source, stale ids, failed replacement keeps old active.
- `memory2/adapter.test.ts`: `profileFacts`, `fixFact`, `verifyFact`, and `factSource`; blank/wrong-owner rejection; fix persists across reopen; embed failure leaves old active.
- `main/ipc.memory.test.ts`: `fixFact`, `verifyFact`, and `factSource` inject owner id MAIN-side; malicious extra owner/key fields are ignored; stale ids do not fall back to another mutation.
- `preload` / ambient types: `window.memory` shape matches the actual bridge.
- `forgetPanel.test.ts`: fix success updates the row; failed fix/verify/source keeps the row retryable; source renders via `textContent`; forget remains two-step.
- `memoryContext.test.ts`: corrected value appears in the facts-first recall context; old value does not.

Before calling Phase 2 done:

```sh
npx tsc --noEmit -p tsconfig.json
npx vitest run --no-file-parallelism src/main/factStore.test.ts src/main/ipc*.test.ts src/memory2/profileFacts.test.ts src/memory2/adapter.test.ts src/memory2/memoryStore*.test.ts src/renderer/memory/forgetPanel.test.ts src/main/memoryContext.test.ts
npm run verify:packaged-onboarding
```

Run the full serialized suite before PR merge:

```sh
npx vitest run --no-file-parallelism
```

## Non-Goals

- No cloud sync, accounts, or InsForge path.
- No raw transcript source viewer in the first correction slice.
- No renderer-authored facts.
- No key editing unless a single atomic store operation is added first.
- No voice, Live2D, cosmetics, or monetization changes.
