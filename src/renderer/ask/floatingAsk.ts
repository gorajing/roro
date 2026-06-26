// src/renderer/ask/floatingAsk.ts — the thin DOM shell for the floating Ask input + Stop pill.
//
// Lives OUTSIDE #overlay (its own pointer-events island). All decision logic is in the pure
// askMachine / runLifecycle modules (unit-tested); this file only: builds the elements, turns DOM
// events into askMachine events, performs the effects the machine returns, and subscribes to the
// push stream. NOT unit-tested (vitest runs node-env, no DOM) — verified on-screen.
//
// Lifecycle wiring (see runLifecycle): accepted submit arms Stop immediately; run.started captures
// runId; the universal runEnd ENDS the turn (collapses the Ask) — answer/clarify turns have no
// run.started/completed, so runEnd is the only end signal that fires for every turn.
import type { CharacterDriver } from '../character/types';
import { askReduce, INITIAL_ASK_STATE, type AskState, type AskEffect, type AskEvent } from './askMachine';
import { reduceRun, INITIAL_RUN_LIFECYCLE, type RunLifecycle } from '../events/runLifecycle';
import { getCompanion } from '../events/bridge';
import { ensureWorkdirReady, notifyWorkdirConfigured } from '../bootstrap/workdirSetup';
import { actionableErrorCopy, isStoppedTerminalError, typedTurnEndStatus } from '../events/errorCopy';
import type { ActionEvent } from '../../shared/events';

interface FloatingAskSmokeHook {
  startTask(text: string): void;
  action(e: ActionEvent): void;
  runEnd(): void;
  state(): {
    ask: AskState;
    run: RunLifecycle;
    cancelRequests: Array<string | undefined>;
    pillText: string;
    errorText: string;
    errorHidden: boolean;
  };
}

function smokeWindow(): { __roroFloatingAskSmoke?: FloatingAskSmokeHook } {
  return window as unknown as { __roroFloatingAskSmoke?: FloatingAskSmokeHook };
}

export function mountFloatingAsk(opts: {
  driver: CharacterDriver;
  sessionId: string;
  canStartTurn?: () => boolean;
  smokeLifecycle?: boolean;
}): () => void {
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

  const error = document.createElement('div');
  error.id = 'floating-error';
  error.hidden = true;

  host.append(form, stop, error);

  let ask: AskState = INITIAL_ASK_STATE;
  let run: RunLifecycle = INITIAL_RUN_LIFECYCLE;
  let submitPending = false;
  let stopAvailable = false;
  let stopRequested = false;
  let acceptedRunId: string | null = null;
  let turnSerial = 0;
  let activeTurnSerial = 0;
  const smokeCancelRequests: Array<string | undefined> = [];

  function showNotice(message: string, tone: 'error' | 'neutral'): void {
    error.textContent = message;
    error.classList.toggle('neutral', tone === 'neutral');
    error.hidden = false;
  }

  function showFailure(message: string): void {
    showNotice(message, 'error');
  }

  function clearFailure(): void {
    error.textContent = '';
    error.classList.remove('neutral');
    error.hidden = true;
  }

  function render(): void {
    form.classList.remove('collapsed', 'expanded', 'tasked');
    form.classList.add(ask);
    stop.classList.toggle('armed', stopAvailable);
    stop.textContent = stopRequested ? 'Stopping...' : 'Stop';
  }

  function applyEffect(eff: AskEffect): void {
    switch (eff.type) {
      case 'focusInput':
        clearFailure();
        stopRequested = false;
        acceptedRunId = null;
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
          console.warn('[floatingAsk] Roro bridge unavailable: window.companion.turnRun missing.');
          showFailure('Roro lost its connection. Reopen Roro and try again.');
          // No bridge -> the turn can't run and no runEnd will arrive; recover so the Ask never
          // sticks in 'tasked'. Defer so we don't re-enter the in-flight dispatch.
          queueMicrotask(() => dispatch({ type: 'runEnded' }));
          break;
        }
        const turnToken = ++turnSerial;
        activeTurnSerial = turnToken;
        acceptedRunId = null;
        void companion.turnRun({ transcript: eff.text, sessionId }).then(({ runId }) => {
          if (activeTurnSerial !== turnToken || ask !== 'tasked') return;
          acceptedRunId = runId;
          if (stopRequested) void companion.cancelTask?.(runId);
        }).catch(() => {
          // turnRun returns {runId} even on a decide failure (it pushes run.failed + runEnd); a
          // reject is an IPC-level failure, so no runEnd will arrive — recover the surface here.
          showFailure('Task could not start. Reopen Roro and try again.');
          dispatch({ type: 'runEnded' });
        });
        break;
      }
      case 'showTasked':
        clearFailure();
        stopRequested = false;
        pill.textContent = `tasked: ${eff.text}`;
        break;
      case 'collapse':
        input.value = '';
        pill.textContent = 'Ask Roro…';
        stopAvailable = false;
        stopRequested = false;
        acceptedRunId = null;
        activeTurnSerial = 0;
        break;
      case 'armStop':
        stopAvailable = true;
        break;
      case 'disarmStop':
        stopAvailable = false;
        stopRequested = false;
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
    render();
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
      clearFailure();
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

  function applySmokeTask(text: string): void {
    const result = askReduce(ask, { type: 'submit', text });
    ask = result.state;
    render();
    for (const eff of result.effects) {
      if (eff.type === 'setThinkingPose') {
        driver.setState('thinking');
      } else if (eff.type === 'showTasked') {
        clearFailure();
        stopRequested = false;
        acceptedRunId = null;
        pill.textContent = `tasked: ${eff.text}`;
      } else if (eff.type === 'collapse') {
        input.value = '';
        pill.textContent = 'Ask Roro…';
        stopAvailable = false;
        stopRequested = false;
        acceptedRunId = null;
        activeTurnSerial = 0;
      } else if (eff.type === 'armStop') {
        stopAvailable = true;
      } else if (eff.type === 'disarmStop') {
        stopAvailable = false;
        stopRequested = false;
      }
    }
    render();
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
    if (!stopAvailable) return;
    stopRequested = true;
    render();
    const runId = run.runId ?? acceptedRunId ?? undefined;
    if (opts.smokeLifecycle) smokeCancelRequests.push(runId);
    void getCompanion()?.cancelTask?.(runId);
  });

  // ---- push-stream subscriptions ----
  const companion = getCompanion();
  const unsubs: Array<() => void> = [];
  const handleActionEvent = (e: ActionEvent): void => {
    run = reduceRun(run, e); // run.started -> running+armed+runId; completed/failed -> disarm
    if (e.kind === 'run.started') {
      acceptedRunId = e.runId;
      clearFailure();
      dispatch({ type: 'runStarted' });
    } else {
      if (e.kind === 'run.completed') {
        stopAvailable = false;
        stopRequested = false;
        acceptedRunId = null;
      }
      if (e.kind === 'run.failed') {
        const stopped = stopRequested || isStoppedTerminalError(e.error);
        stopAvailable = false;
        stopRequested = false;
        acceptedRunId = null;
        if (stopped) showNotice(typedTurnEndStatus(true, e.error), 'neutral');
        else showFailure(`Task hit a problem: ${actionableErrorCopy(e.error)}`);
      }
      render(); // reflect a disarm (completed/failed) without touching the Ask state
    }
  };
  const handleRunEnd = (): void => {
    run = INITIAL_RUN_LIFECYCLE;
    stopAvailable = false;
    stopRequested = false;
    acceptedRunId = null;
    activeTurnSerial = 0;
    dispatch({ type: 'runEnded' });
  };
  if (companion?.onActionEvent) {
    unsubs.push(companion.onActionEvent(handleActionEvent));
  }
  if (companion?.onRunEnd) {
    // Universal turn-ended signal (fires for answer turns too): collapse the Ask, reset run-state.
    unsubs.push(companion.onRunEnd(handleRunEnd));
  }
  if (companion?.onFocusAsk) {
    unsubs.push(companion.onFocusAsk(() => dispatch({ type: 'summon' })));
  }

  if (opts.smokeLifecycle) {
    smokeWindow().__roroFloatingAskSmoke = {
      startTask: applySmokeTask,
      action: handleActionEvent,
      runEnd: handleRunEnd,
      state: () => ({
        ask,
        run,
        cancelRequests: [...smokeCancelRequests],
        pillText: pill.textContent ?? '',
        errorText: error.textContent ?? '',
        errorHidden: error.hidden,
      }),
    };
  }

  render();
  return () => {
    for (const u of unsubs) u();
    if (opts.smokeLifecycle && smokeWindow().__roroFloatingAskSmoke?.action === handleActionEvent) {
      delete smokeWindow().__roroFloatingAskSmoke;
    }
    form.remove();
    stop.remove();
    error.remove();
  };
}
