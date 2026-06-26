// src/renderer/ask/floatingAsk.ts — the thin DOM shell for the floating Ask input + Stop pill.
//
// Lives OUTSIDE #overlay (its own pointer-events island). All decision logic is in the pure
// askMachine / runLifecycle modules (unit-tested); this file only: builds the elements, turns DOM
// events into askMachine events, performs the effects the machine returns, and subscribes to the
// push stream. NOT unit-tested (vitest runs node-env, no DOM) — verified on-screen.
//
// Lifecycle wiring (see runLifecycle): run.started ARMS the Stop + captures runId; the universal
// runEnd ENDS the turn (collapses the Ask) — answer/clarify turns have no run.started/completed, so
// runEnd is the only end signal that fires for every turn.
import type { CharacterDriver } from '../character/types';
import { askReduce, INITIAL_ASK_STATE, type AskState, type AskEffect, type AskEvent } from './askMachine';
import { reduceRun, INITIAL_RUN_LIFECYCLE, type RunLifecycle } from '../events/runLifecycle';
import { getCompanion } from '../events/bridge';
import { ensureWorkdirReady, notifyWorkdirConfigured } from '../bootstrap/workdirSetup';
import type { ActionEvent } from '../../shared/events';

export function mountFloatingAsk(opts: { driver: CharacterDriver; sessionId: string; canStartTurn?: () => boolean }): () => void {
  const { driver, sessionId } = opts;
  const host = document.getElementById('app') ?? document.body;

  const form = document.createElement('form');
  form.id = 'floating-ask';
  form.setAttribute('autocomplete', 'off');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'ask-pill';
  pill.textContent = 'Ask Roro…';
  const input = document.createElement('input');
  input.id = 'ask-input';
  input.type = 'text';
  input.placeholder = 'Ask Roro…';
  input.setAttribute('autocomplete', 'off');
  form.append(pill, input);

  const stop = document.createElement('button');
  stop.type = 'button';
  stop.id = 'floating-stop';
  stop.textContent = 'Stop';

  host.append(form, stop);

  let ask: AskState = INITIAL_ASK_STATE;
  let run: RunLifecycle = INITIAL_RUN_LIFECYCLE;
  let submitPending = false;

  function render(): void {
    form.classList.remove('collapsed', 'expanded', 'tasked');
    form.classList.add(ask);
    stop.classList.toggle('armed', run.stopArmed);
  }

  function applyEffect(eff: AskEffect): void {
    switch (eff.type) {
      case 'focusInput':
        input.focus();
        input.select();
        break;
      case 'poke':
        driver.poke?.();
        break;
      case 'setThinkingPose':
        // Local optimistic pose, set synchronously before turnRun is awaited (≤16ms budget).
        driver.setState('thinking');
        break;
      case 'startTurn': {
        const companion = getCompanion();
        if (!companion?.turnRun) {
          // No bridge -> the turn can't run and no runEnd will arrive; recover so the Ask never
          // sticks in 'tasked'. Defer so we don't re-enter the in-flight dispatch.
          queueMicrotask(() => dispatch({ type: 'runEnded' }));
          break;
        }
        void companion.turnRun({ transcript: eff.text, sessionId }).catch(() => {
          // turnRun returns {runId} even on a decide failure (it pushes run.failed + runEnd); a
          // reject is an IPC-level failure, so no runEnd will arrive — recover the surface here.
          dispatch({ type: 'runEnded' });
        });
        break;
      }
      case 'showTasked':
        pill.textContent = `tasked: ${eff.text}`;
        break;
      case 'collapse':
        input.value = '';
        pill.textContent = 'Ask Roro…';
        break;
      case 'armStop':
      case 'disarmStop':
        // Stop visibility is driven by run.stopArmed in render(); these are no-ops here.
        break;
    }
  }

  function dispatch(event: AskEvent): void {
    const result = askReduce(ask, event);
    ask = result.state;
    // Reflect the new state in the DOM BEFORE running effects: focusInput must hit a VISIBLE input
    // (a collapsed input is display:none, and focus() on a hidden element is a no-op).
    render();
    for (const eff of result.effects) applyEffect(eff);
  }

  async function submitIfReady(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || ask !== 'expanded') {
      dispatch({ type: 'submit', text: rawText });
      return;
    }
    if (submitPending) return;

    const companion = getCompanion();
    if (!companion?.turnRun) return;

    submitPending = true;
    try {
      const getWorkdirConfig = companion.getWorkdirConfig;
      const chooseWorkdir = companion.chooseWorkdir;
      if (getWorkdirConfig && chooseWorkdir) {
        const ready = await ensureWorkdirReady({
          getConfig: getWorkdirConfig,
          chooseWorkdir,
          onConfigured: notifyWorkdirConfigured,
        });
        if (!ready) return;
      }

      if (opts.canStartTurn?.() === false) return;

      if (ask !== 'expanded' || input.value.trim() !== text) return;
      dispatch({ type: 'submit', text });
    } finally {
      submitPending = false;
    }
  }

  // ---- DOM bindings ----
  pill.addEventListener('click', () => dispatch({ type: 'summon' }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submitIfReady(input.value);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      dispatch({ type: 'dismiss' });
    }
  });
  stop.addEventListener('click', () => {
    void getCompanion()?.cancelTask?.(run.runId ?? undefined);
  });

  // ---- push-stream subscriptions ----
  const companion = getCompanion();
  const unsubs: Array<() => void> = [];
  if (companion?.onActionEvent) {
    unsubs.push(
      companion.onActionEvent((e: ActionEvent) => {
        run = reduceRun(run, e); // run.started -> running+armed+runId; completed/failed -> disarm
        if (e.kind === 'run.started') dispatch({ type: 'runStarted' });
        else render(); // reflect a disarm (completed/failed) without touching the Ask state
      }),
    );
  }
  if (companion?.onRunEnd) {
    // Universal turn-ended signal (fires for answer turns too): collapse the Ask, reset run-state.
    unsubs.push(
      companion.onRunEnd(() => {
        run = INITIAL_RUN_LIFECYCLE;
        dispatch({ type: 'runEnded' });
      }),
    );
  }
  if (companion?.onFocusAsk) {
    unsubs.push(companion.onFocusAsk(() => dispatch({ type: 'summon' })));
  }

  render();
  return () => {
    for (const u of unsubs) u();
    form.remove();
    stop.remove();
  };
}
