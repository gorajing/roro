# Roro Phase B — Floating Ask Input + Stop Pill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`.

**Goal:** Add a typed command surface to the floating cat — an "Ask Roro…" input + a Stop pill, outside `#overlay` — so the typed magic moment works on the cat itself, with the turn lifecycle driven by the push-event stream (the dispatch-return hinge already shipped).

**Architecture:** All decision logic is in PURE modules (node-testable, no DOM): `askMachine` (the Ask surface state machine), `runLifecycle` (ActionEvent stream → run status + runId + stop-armed), `summon` (the ⌘⇧Space window decision). A thin DOM shell (`floatingAsk.ts`) performs the effects the machine returns and is verified on-screen. New elements live OUTSIDE `#overlay`; never un-hide the dev panel.

**Tech Stack:** TypeScript, Electron 42 (main + preload + renderer), Vitest (node env, colocated `*.test.ts`).

## Global Constraints

- **New elements OUTSIDE `#overlay`** — `#floating-ask`, `#floating-stop`. Never modify the `#overlay` hide rule. Each gets its own `pointer-events:auto` island; the window stays click-through elsewhere.
- **Stream-driven lifecycle** — `run.started`/`run.completed`/`run.failed` drive UI state, NOT the `turnRun` promise (resolves at dispatch).
- **One turn at a time** — submit while a run is live is ignored (preempt is C1).
- **Empty Enter is a no-op checked BEFORE any pose** — never flash `thinking`.
- **Optimistic local pose** — `thinking` is set synchronously in the handler before the `turnRun` await (≤16ms).
- **Cat body stays pet/move only** — summon is the collapsed pill (click) + `⌘⇧Space`. No new body verb.
- Frozen `ActionEvent`/`Decision` contracts unchanged.

---

### Task 1: `askMachine` — the pure Ask surface state machine

**Files:** Create `src/renderer/ask/askMachine.ts`, `src/renderer/ask/askMachine.test.ts`

**Interfaces — Produces:**
```ts
export type AskState = 'collapsed' | 'expanded' | 'tasked';
export type AskEvent =
  | { type: 'summon' }
  | { type: 'dismiss' }                 // Esc
  | { type: 'submit'; text: string }
  | { type: 'runStarted' }
  | { type: 'runEnded' };
export type AskEffect =
  | { type: 'focusInput' }
  | { type: 'poke' }
  | { type: 'setThinkingPose' }
  | { type: 'startTurn'; text: string }
  | { type: 'armStop' }
  | { type: 'disarmStop' }
  | { type: 'showTasked'; text: string }
  | { type: 'collapse' };
export interface AskResult { state: AskState; effects: AskEffect[] }
export function askReduce(state: AskState, event: AskEvent): AskResult;
export const INITIAL_ASK_STATE: AskState; // 'collapsed'
```

**Transition rules (the test contract):**
- `collapsed` + `summon` → `expanded`, effects `[focusInput, poke]`.
- `expanded` + `summon` → `expanded`, effects `[]` (already open; window-level hide is the shell's job).
- `expanded` + `dismiss` → `collapsed`, effects `[collapse]`.
- `collapsed`/`tasked` + `dismiss` → unchanged, `[]`.
- `expanded` + `submit` with **empty/whitespace** text → `expanded`, `[]` (NO pose).
- `expanded` + `submit` with non-empty text → `tasked`, effects `[setThinkingPose, startTurn(text.trim()), showTasked(text.trim())]` (pose FIRST so it's set before the shell awaits).
- `tasked` + `submit` → unchanged, `[]` (one turn at a time).
- `tasked` + `runStarted` → `tasked`, `[armStop]`.
- `tasked` + `runEnded` → `collapsed`, effects `[disarmStop, collapse]`.
- `expanded`/`collapsed` + `runEnded` → unchanged except always `[disarmStop]` is safe; keep minimal: `collapsed`/`expanded` + `runStarted`/`runEnded` → unchanged, `[]`.

- [ ] **Step 1: failing tests** — one `it` per rule above (e.g. empty submit yields no `setThinkingPose`; non-empty submit's effects[0] is `setThinkingPose`; `tasked`+`submit` ignored; `tasked`+`runEnded`→collapsed+disarmStop).
- [ ] **Step 2:** run `npx vitest run src/renderer/ask/askMachine.test.ts` → FAIL (missing module).
- [ ] **Step 3:** implement `askReduce` as a pure switch on `(state, event.type)` returning `{state, effects}`.
- [ ] **Step 4:** run → PASS.

---

### Task 2: `runLifecycle` — ActionEvent stream → run status + runId + stop-armed

**Files:** Create `src/renderer/events/runLifecycle.ts`, `runLifecycle.test.ts`

**Interfaces — Produces:**
```ts
import type { ActionEvent } from '../../shared/events';
export type RunStatus = 'idle' | 'running' | 'done' | 'failed';
export interface RunLifecycle { status: RunStatus; runId: string | null; stopArmed: boolean }
export const INITIAL_RUN_LIFECYCLE: RunLifecycle; // {status:'idle', runId:null, stopArmed:false}
export function reduceRun(state: RunLifecycle, e: ActionEvent): RunLifecycle;
```

**Rules (test contract):**
- `run.started` → `{status:'running', runId:e.runId, stopArmed:true}`.
- `run.completed` → `{status:'done', runId:null, stopArmed:false}`.
- `run.failed` → `{status:'failed', runId:null, stopArmed:false}`.
- any other kind → unchanged.

- [ ] Step 1: failing tests (started arms + captures runId; completed/failed disarm + clear runId; a `message` event is a no-op).
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement the pure reducer.
- [ ] Step 4: run → PASS.

---

### Task 3: `⌘⇧Space` summon decision + `CH.focusAsk` wiring

**Files:** Create `src/main/summon.ts`, `src/main/summon.test.ts`; Modify `src/shared/ipc.ts`, `src/main/window.ts:97-111`, `src/preload.ts:79-87`, `src/types/companion.d.ts:51-54`

**Interfaces — Produces:**
```ts
// src/main/summon.ts
export interface SummonWindowState { visible: boolean; focused: boolean; floating: boolean }
export type SummonAction = 'hide' | 'show-and-focus-ask' | 'show';
export function decideSummonAction(s: SummonWindowState): SummonAction;
```
**Rules:** visible && focused → `hide`. else if floating → `show-and-focus-ask`. else → `show`.

- [ ] Step 1: failing tests for the three branches.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS.
- [ ] Step 5: `src/shared/ipc.ts` — add `focusAsk: 'window:focusAsk',` to `CH`.
- [ ] Step 6: `src/main/window.ts` — replace the inline summon body with `decideSummonAction({visible: win.isVisible(), focused: win.isFocused(), floating: FLOATING_WINDOW_FLAG})`; on `'hide'` → `win.hide()`; on `'show-and-focus-ask'` → `win.showInactive(); win.webContents.send(CH.focusAsk)`; on `'show'` → `win.show(); win.focus()`. Import `decideSummonAction`.
- [ ] Step 7: `src/preload.ts` — add to the `companion` object: `onFocusAsk: (cb: () => void): (() => void) => subscribe<void>(CH.focusAsk, () => cb()),`.
- [ ] Step 8: `src/types/companion.d.ts` — add to `CompanionBridge`: `onFocusAsk(cb: () => void): () => void;`.
- [ ] Step 9: `npx tsc --noEmit` → 0 errors.

---

### Task 4: `floatingAsk` DOM shell + elements + CSS + bootstrap mount

**Files:** Create `src/renderer/ask/floatingAsk.ts`; Modify `index.html`, `src/index.css`, `src/renderer/bootstrap.ts`

> **No unit test** (vitest is node-env, no DOM). The pure logic is covered by Tasks 1-2; this shell is verified on-screen (Task 5). Keep it THIN: it only translates DOM events → `askReduce`, performs the returned effects, and subscribes to the stream + `onFocusAsk`.

**`floatingAsk.ts` shape:**
```ts
import type { CharacterDriver } from '../character/types';
import { askReduce, INITIAL_ASK_STATE, type AskState, type AskEffect } from './askMachine';
import { reduceRun, INITIAL_RUN_LIFECYCLE } from '../events/runLifecycle';
import { getCompanion } from '../events/bridge';

export function mountFloatingAsk(opts: { driver: CharacterDriver; sessionId: string }): void {
  // build #floating-ask (form: a button.pill "Ask Roro…" + an input + collapsed/tasked classes)
  // and #floating-stop (button hidden until armed), append to #app (NOT #overlay).
  // state: AskState + RunLifecycle. dispatch(event) = askReduce -> apply effects -> re-render DOM.
  // effects: focusInput->input.focus(); poke->driver.poke(); setThinkingPose->driver.setState('thinking');
  //   startTurn(text)->void getCompanion()?.turnRun?.({transcript:text, sessionId}); showTasked->render;
  //   armStop->show #floating-stop; disarmStop->hide; collapse->render collapsed + clear input.
  // bindings: pill click & input-empty Enter? -> the form submit handler calls dispatch({type:'submit',text});
  //   click pill (collapsed) -> dispatch({type:'summon'}); Esc on input -> dispatch({type:'dismiss'}).
  //   #floating-stop click -> void getCompanion()?.cancelTask?.(run.runId ?? undefined).
  //   companion.onActionEvent(e => { run = reduceRun(run, e); if e.kind==='run.started' dispatch({type:'runStarted'});
  //     else if terminal dispatch({type:'runEnded'}); reflect run.stopArmed on the pill. });
  //   companion.onFocusAsk(() => dispatch({type:'summon'})).
}
```

- [ ] Step 1: `index.html` — add, as siblings of `#overlay` inside `#app`, `<form id="floating-ask">…</form>` and `<button id="floating-stop">Stop</button>`. Also fix the stale topbar label `Memory: <b>Insforge</b> · pgvector` → `Memory: <b>Local</b> · PGlite + pgvector`.
- [ ] Step 2: `src/index.css` — add `#floating-ask`/`#floating-stop` rules: positioned bottom-center under the cat, hidden in non-floating mode OR shown in both (decide: show in floating mode; in dev mode the `#prompt-form` already exists, so gate `#floating-ask` on `body.floating-window`). `pointer-events:auto` only on the pill/input/stop. Collapsed = small translucent pill; expanded = input visible; `.tasked` = muted pill text; `#floating-stop` `display:none` unless `.armed`.
- [ ] Step 3: `src/renderer/bootstrap.ts` — after `subscribeActionEvents(...)`, call `mountFloatingAsk({ driver, sessionId })`. Remove the stale post-await status: change the `#prompt-form` handler so `setStatus('Done…')` is NOT set from the `turnRun` await (the run is still going); let the existing `run.completed`/`run.failed` `onActionEvent` handler (lines ~194-200) own the terminal status. Concretely: after `await companion.turnRun(...)`, set status to `'Working…'` (dispatch), not `'Done'`.
- [ ] Step 4: `npx tsc --noEmit` → 0 errors; `npx vitest run` → all green (no new unit tests here, existing suite unaffected).

---

### Task 5: Verify + Codex review + PR

- [ ] Step 1: `npx tsc --noEmit` (0 errors) + `npx vitest run` (all green, incl. Tasks 1-3 new tests).
- [ ] Step 2: **On-screen check (flag explicitly):** the floating Ask/Stop render is NOT unit-testable here (no browser harness). State it's verified via `COMPANION_FLOATING_WINDOW=1 npm start` + CDP or by the user — do not claim visual success from code-reading.
- [ ] Step 3: **Codex max-effort review** of the staged diff (the loop from the codex-review skill); adjudicate + fix real findings (TDD) until `none`.
- [ ] Step 4: Push `feat/b-magic-moment`; the PR (#2) updates. Retitle it "Phase B — the magic moment (floating Ask + Stop, dispatch-return)".

## Self-Review

- **Spec coverage:** Ask 3-states (T1) ✓ · Stop pill stream-subscribed + cancelTask(runId) (T2+T4) ✓ · summon click+⌘⇧Space→focus+poke (T1 effects + T3) ✓ · empty-Enter-before-pose (T1) ✓ · optimistic local pose (T1 effect ordering + T4 shell sets it before await) ✓ · lifecycle stream-driven (T2+T4) ✓ · outside `#overlay` (T4) ✓ · Esc dismiss (T1) ✓ · one-turn-at-a-time (T1 tasked+submit ignored) ✓ · dev-form lifecycle fix (T4) ✓. Out of scope (Menu/confirm/preempt/voice) — correctly absent.
- **Placeholder scan:** none (DOM shell intentionally described, not unit-tested, per the node-env constraint — flagged).
- **Type consistency:** `AskState`/`AskEvent`/`AskEffect` (T1) consumed in T4; `RunLifecycle`/`reduceRun` (T2) consumed in T4; `decideSummonAction`/`CH.focusAsk` (T3) consumed in window.ts + preload; `onFocusAsk` defined in preload (T3) + companion.d.ts (T3) + consumed in T4. ✓
