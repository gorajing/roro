# Roro Phase B — Floating Ask Input + Stop Pill (Design Spec)

> **Status:** approved 2026-06-22. The deep interaction rationale lives in the v2 spine
> (`2026-06-21-nero-ultimate-ux-design-PROPOSAL.md`, §Pillar III + the Phase-B row). This doc is the
> **focused, code-reconciled implementation design** for Phase B, to be turned into a TDD plan.

## Goal

Make the **typed magic moment** work on the floating cat itself: you type a task to the desktop
cat and watch it drive the coding agent, with a Stop you can hit any time. Today a task can only be
typed in the hidden dev `#overlay`; in floating mode the cat has no command surface. Phase B adds
one — a small Ask input + a Stop pill — **outside `#overlay`**, and migrates the turn lifecycle onto
the push-event stream (required by the already-shipped "`turnRun` resolves at dispatch" hinge).

**Why typed-first (not voice-first):** voice (Phase D) is *mouth-not-brain* — a committed
transcript routes through the SAME `turnRun` pipe a typed task uses. Phase B builds ~90% of what
voice needs (turn lifecycle, Stop, run-state, cat reactions); voice later just adds an STT "ear" in
front of the same pipe. Typing is also the silent/precise door devs need regardless.

## Locked decisions (don't re-litigate)

- **Summon = the collapsed Ask pill IS the handle.** `#floating-ask` rests as a subtle
  "Ask Roro…" pill under the cat (discoverable, mouse-friendly); clicking it OR pressing
  `⌘⇧Space` expands it to a focused input. The cat body stays **pet/move only** — no new body verb
  (double-click is rejected: it disambiguates by milliseconds, which Interaction Law 1 forbids, and
  fights `pet`).
- **New elements live OUTSIDE `#overlay`** (the structural non-negotiable). Never un-hide the dev
  overlay. Each new element gets its own `pointer-events` box so the transparent window stays
  click-through everywhere else.
- **Stop pill subscribes to the push stream directly** (independent of the hidden `#cancel-btn`),
  arms on `run.started`, and calls `cancelTask(runId)` with the id it captured.
- **Lifecycle is stream-driven.** `run.started` / `run.completed` / `run.failed` drive busy/done/
  Stop state — NOT the `turnRun` promise (which now resolves at dispatch).
- **One turn at a time** in Phase B. Mid-run preempt / `cancelTurn` is **C1**, not here.

## Scope

**In B:** floating Ask input (3 states), Stop pill, `⌘⇧Space` summon→focus+poke, the
`turnInFlight → stream-driven run-state` migration, `Esc` to dismiss Ask, the empty-Enter and
optimistic-local-pose rules. **Not in B (per the spine):** native Menu/Tray/⌘K (cut), destructive
confirm chip (C1), preempt/`cancelTurn` (C1), voice (D).

## Components & boundaries

Designed so the testable logic is pure (no DOM), and the DOM/CSS is a thin shell.

1. **`askMachine` (pure, `src/renderer/ask/askMachine.ts`)** — the Ask surface state machine.
   - States: `collapsed` (resting "Ask Roro…" pill) · `expanded` (focused input) · `tasked`
     (`tasked: <text>` pill while a run is live).
   - Inputs (events): `summon` · `dismiss` (Esc) · `submit(text)` · `runStarted` · `runEnded`.
   - Output: next state + a list of effects (`focusInput`, `poke`, `setThinkingPose`,
     `startTurn(text)`, `armStop`, `disarmStop`, `clearInput`). Effects are returned as data; the
     shell performs them. This keeps every transition rule unit-testable.
   - Rules baked in: **empty `submit` is a no-op checked BEFORE any pose/effect** (an empty Enter
     never emits `setThinkingPose`); `submit` while `tasked` is ignored (one turn at a time);
     `summon` while already `expanded` is a no-op (the *window-level* toggle/hide is the shell's job).
2. **`runLifecycle` (pure, `src/renderer/events/runState.ts` — extend the existing file)** — maps the
   ActionEvent stream to a small run-state (`idle | running | done | failed`) + whether Stop is armed
   and the active `runId`. The Stop pill and the busy pose read this; replaces the `await turnRun →
   'Done'` assumption in `bootstrap`.
3. **DOM shell (`src/renderer/ask/floatingAsk.ts`)** — builds `#floating-ask` + `#floating-stop`,
   binds click/keydown/submit, subscribes to the push stream + `onFocusAsk`, and drives `askMachine`
   + `driver`. The ONLY place DOM lives. Mounted by `bootstrap` in floating mode (and reusable in dev
   mode); the dev `#prompt-form` shares the same `startTurn`/lifecycle path (no divergent logic).
4. **Main-side summon (`src/main/window.ts` + `CH.focusAsk`)** — extend the existing `⌘⇧Space`
   handler: on hidden→show in floating mode, also `webContents.send(CH.focusAsk)`; on visible→hide,
   send nothing (don't wake a cat you're dismissing). `preload` exposes `onFocusAsk(cb)`.

## Data flow (a typed turn on the floating cat)

```
click pill / ⌘⇧Space ─▶ askMachine: collapsed→expanded  (effects: focusInput, poke)   [≤150ms]
type + Enter ─▶ askMachine.submit(text)
   empty?  → no-op (no pose)                                                            [Coherence]
   else    → effects: setThinkingPose (LOCAL, sync, before any await) [≤16ms]
            → startTurn(text): companion.turnRun({transcript, sessionId})  (resolves at dispatch)
            → state→tasked ("tasked: …")
push stream ─▶ run.started  → runLifecycle: running; askMachine.runStarted → armStop
            ─▶ run.completed/failed → runLifecycle: done/failed; askMachine.runEnded → collapsed
Stop pill (click) ─▶ companion.cancelTask(activeRunId)
Esc ─▶ askMachine.dismiss → collapsed (only if expanded; else no-op)
```

## DOM / CSS

- `index.html`: add `#floating-ask` (a `<form>` with the pill/input) and `#floating-stop` as
  siblings of `#overlay` inside `#app`. Fix the stale `Memory: Insforge · pgvector` topbar label to
  `Local · PGlite + pgvector` while here (one-line truthfulness fix).
- `src/index.css`: new rules (NOT changes to the `#overlay` hide rule). In floating mode:
  `#floating-ask` bottom-center under the cat, `pointer-events:auto` only on the pill/input;
  collapsed vs expanded vs tasked styling; `#floating-stop` shown only when armed. Keep the window
  click-through everywhere else.

## Latency budgets (from the spine)

tap→hearts ≤16ms · **Enter→thinking ≤16ms (local pose, set before the await)** · summon→visible
≤150ms. The first avatar change on a turn is a **renderer-local optimistic pose**, reconciled when
the stream arrives.

## Testing

- **Unit (Vitest, pure):** `askMachine` transitions — empty-Enter-never-thinking; submit-while-
  tasked ignored; `runStarted` arms Stop; `runEnded` returns to collapsed; summon/dismiss. The
  window summon-toggle logic (hidden→show+focus+poke; visible→hide+no-poke) as a pure function of
  window state. `runLifecycle` mapping from the event stream.
- **On-screen E2E (the spine's net):** a typed turn on the floating body produces `run.started`; a
  second-launch turn surfaces a prior-session fact in the narration; an empty Enter never flashes
  thinking. **No browser test harness exists in-repo**; this is driven via CDP or verified manually —
  the spec flags it explicitly rather than claiming success from code-reading.

## Reconciliations resolved

- The `⌘⇧Space` global shortcut already exists (`window.ts`, show/hide); Phase B extends it to also
  focus the Ask + poke on show.
- `bootstrap.ts:224`'s "`turnRun` resolves once the whole turn ends" comment is now false (the hinge
  shipped); the lifecycle migration in this spec corrects it.
- The dev `#prompt-form` stays functional in non-floating mode by sharing the `startTurn`/lifecycle
  path — not a second implementation.
