# Roro Phase C1 — Reliability (Design Spec)

> **Status:** approved direction (the adopted v2 spine `2026-06-21-nero-ultimate-ux-design-PROPOSAL.md`
> §Pillar III + CONFLICT 2 IS the spec; this doc is the code-reconciled implementation design). Build
> order is locked A.5 → B → **C1** → C2 → D. C1 is the layer voice (D) depends on — a spoken word
> must never be able to approve `rm -rf`, and Stop must be provably terminal.

## Goal

Make Roro's turns **interruptible and safe**: a `status` ActionEvent kind for legible non-action
beats; **preempt** (barge-in — a new task mid-run cancels the old and starts fresh); a **Stop
watchdog** so cancel is provably terminal; and a **destructive-confirm gate** so a dangerous command
(`rm -rf`, `git push --force`, …) requires an explicit, dedicated approval click — never a stray
spoken/typed word.

## The four pieces

### 1. `status` ActionEvent kind (then RE-FREEZE the union)
- Add **one** member: `{ kind: 'status'; runId: string; text: string; ts: number }`. The union goes
  10 → **11 kinds, then re-frozen.** Confirm/deny is **NOT** a kind (it rides a separate IPC pair, §4).
- `shared/avatar.ts` `eventToAvatarState`: **no change** — its default already returns `null` (status
  doesn't drive an avatar state). Verify, don't edit.
- `renderer/events/actionEvents.ts` `activityForEvent`: add a `status` case mapping the memory beat to
  the memory cue; **migrate** the existing `message`-prefixed `"Memory:"` detection onto `status`.
- Producer: the orchestrator's recall beat changes `kind:'message'` → `kind:'status'` (it was always a
  status line, not assistant text). This is the A.5 plan's noted "migrates to kind:'status' in C1".

### 2. Preempt (barge-in)
- `turnRun` already resolves at dispatch (B). **Renderer-side:** a submit while a turn is live reads
  the active `runId` from run-state, calls `cancelTask(runId)`, and on that turn's `runEnd` fires the
  new `turnRun`. (Floating Ask: relax the one-turn-at-a-time guard into preempt; the dev form too.)
- **Pre-executor preempt** (a turn still in recall/decide, no executor registered): a new orchestrator
  `cancelTurn(runId)` sets an abort flag checked at the `decideStreaming` boundary and again before
  `dispatchExecutor`, so a barge-in during decide is honored without an executor handle. `decide`
  becomes abortable (pass the signal / check the flag).

### 3. Stop watchdog
- After an abort, a **1.5s SIGKILL watchdog**: if the executor child hasn't produced a terminal event
  within 1.5s of `controller.abort()`, force-kill so "Stop" is provably terminal. Lives in
  `dispatchExecutor`'s cancel path.

### 4. Destructive-confirm gate (a NEW request/response IPC pair — NOT in the union)
- **`classifyDestructive(task: string): { destructive: boolean; reason?: string }`** (pure, fully
  TDD-able): a small high-confidence set — `rm -rf`, `git push --force`/`-f`, `git reset --hard`,
  `drop`/`truncate` (SQL), `dd`, `mkfs`, history-rewrite (`filter-branch`/`filter-repo`/`push
  --mirror`), and **any path outside `workdir()`**.
- **Handshake:** in `actOnDecision`'s `run_agent` branch, **before `dispatchExecutor`**:
  `classifyDestructive(task)` hit → MAIN pushes `CH.confirmRequest {runId, summary}` (push channel) and
  `await`s a Promise held in `pendingConfirms: Map<runId, (approved:boolean)=>void>`. The renderer
  shows a **confirm chip** (a body-posture hook, NOT a 7th avatar state) and on click calls the **new
  invoke channel `CH.confirmResolve {runId, approved}`**, which resolves the Promise. **15s timeout →
  default-DENY.** A denied/timed-out run never dispatches.
- **The spoken/typed transcript can never approve** — approval is the dedicated `CH.confirmResolve`
  channel only.
- **Plus require a clean git tree** before a confirmed-destructive run actually dispatches (a dirty
  tree → deny with an explanation), so a destructive op can always be undone via git.

## Components & boundaries (pure-first, same as A.5/B)

| Unit | File | Responsibility |
|---|---|---|
| `status` kind | `shared/events.ts` | +1 member, re-freeze |
| status cue | `renderer/events/actionEvents.ts` (+test) | map `status` → memory cue |
| `classifyDestructive` | `src/main/destructive.ts` (+test) | **pure** danger classifier |
| `cancelTurn` + abort flag | `src/main/orchestrator.ts` | pre-executor preempt; abortable decide |
| Stop watchdog | `src/main/orchestrator.ts` `dispatchExecutor` | 1.5s SIGKILL after abort |
| confirm handshake | `orchestrator.ts` + `shared/ipc.ts` (`confirmRequest` push, `confirmResolve` invoke) + `pendingConfirms` Map | MAIN-side gate |
| confirm chip | `renderer` (posture hook) + `preload`/`companion.d.ts` (`onConfirmRequest`, `confirmResolve`) | renderer surface |

## Testing
- **Pure unit (Vitest):** `classifyDestructive` (each danger pattern + clean cases + outside-workdir);
  `activityForEvent` status→cue; the confirm gate's resolve/deny/timeout logic factored into a pure
  helper where possible; `cancelTurn` abort-flag honored pre-executor.
- **Executor fixtures** (`__fixtures__/check.ts`): an aborted-mid-stream test (exactly one terminal
  event) and a destructive-flag test (a `rm -rf` task is flagged pre-dispatch).
- **On-screen** (flagged, no browser harness): the confirm chip renders and only its click approves;
  Stop is visibly terminal within 1.5s.

## Scope
In C1: the four pieces above. **Not** in C1: voice (D), `.roro/PROFILE.md` mirror (C2), cosmetics. The
`Executor.resumeId` / `approve?` fields stay cut/deferred.

## Frozen-contract note
`status` is the ONE planned union addition; after it, the 11-kind union is re-frozen. Confirm/deny is
a request/response IPC pair, never a kind — so re-freezing stays honest.
