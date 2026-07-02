// src/renderer/bootstrap.ts — wires the whole renderer together.
//
// Order:
//   1. load config (window mode + the dev/test harness flags)
//   2. build the character (the procedural pixel cat) on #cat-canvas
//   3. subscribe to the executor ActionEvent stream + brain reasoning
//   4. mount the typed prompt + floating Ask surfaces
//
// Voice is CUT from v0 and lives ENTIRELY in packages/voice (outside the app's dependency graph).
// The typed prompt path is the only turn surface; the re-integration seam is src/shared/voiceBackend.ts
// (see packages/voice/README.md for how voice mounts back in).

import { loadConfig } from './config';
import { sessionId } from './session';
import { createCharacter } from './character/driver';
import { CaptionPanel, ActionTimeline } from './character/captions';
import { subscribeActionEvents } from './events/actionEvents';
import { mountFloatingAsk } from './ask/floatingAsk';
import { mountConfirmChip } from './confirm/confirmChip';
import { mountForgetPanel } from './memory/forgetPanel';
import { createMemoryPanelSmokeDeps } from './memory/smokeBridge';
import { mountProjectSettings } from './settings/projectSettings';
import { mountCosmeticsStore } from './cosmetics/cosmeticsStore';
import { mountBootstrapBanner } from './bootstrap/bootstrapBanner';
import { mountMemoryHealthBanner } from './bootstrap/memoryHealthBanner';
import { createBrainReadinessGate } from './bootstrap/brainReadiness';
import { mountWorkdirBanner } from './bootstrap/workdirBanner';
import { mountTypedPrompt } from './bootstrap/typedPrompt';
import { getCompanion } from './events/bridge';
import { runState } from './events/runState';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string): void {
  const s = el('status');
  if (s) s.textContent = text;
}

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  document.documentElement.classList.toggle('floating-window', config.floatingWindow);
  document.body.classList.toggle('floating-window', config.floatingWindow);

  const canvas = el<HTMLCanvasElement>('cat-canvas');
  if (!canvas) {
    console.error('[bootstrap] #cat-canvas not found');
    return;
  }

  // 1 + 2: character (always resolves — the pixel cat is procedural).
  const { driver, avatar } = await createCharacter(canvas);
  setStatus('Roro is ready.');

  // 3: captions + timeline + executor/brain subscriptions.
  const captions = new CaptionPanel();
  const timeline = new ActionTimeline();
  subscribeActionEvents({ character: driver, timeline, captions });

  const brainGate = createBrainReadinessGate({
    subscribe: (cb) => getCompanion()?.onBootstrapStatus?.((s) => cb(s)) ?? (() => undefined),
    getStatus: () => getCompanion()?.getBootstrapStatus?.() ?? Promise.resolve(null),
  });

  // Phase B: the floating Ask input + Stop pill (the typed magic-moment surface on the cat body).
  // Lives outside #overlay; only visible in floating mode. Its lifecycle rides the push stream.
  mountFloatingAsk({
    driver,
    sessionId,
    canStartTurn: (onStatus) => brainGate.ensureReady(onStatus),
    smokeLifecycle: config.floatingSmoke,
  });

  // Phase C1: the destructive-confirm chip (a spoken/typed word can't approve `rm -rf`).
  mountConfirmChip();

  // M7b: first-run one-click model download. MAIN pushes readiness (which essentials are missing); this banner
  // offers a Download button + streams the pull progress. Top-level (#app) so it's visible at first run.
  mountBootstrapBanner({
    subscribe: (cb) => getCompanion()?.onBootstrapStatus?.((s) => cb(s)) ?? (() => undefined),
    getStatus: () => getCompanion()?.getBootstrapStatus?.() ?? Promise.resolve(null),
    refresh: () => getCompanion()?.refreshBootstrapStatus?.() ?? Promise.resolve(null),
    openExternal: (url) => { void getCompanion()?.openExternal?.(url); },
    pull: (models, onProgress) => {
      const unsub = getCompanion()?.onPullProgress?.(onProgress) ?? (() => undefined);
      return (getCompanion()?.pullModels?.(models) ?? Promise.resolve()).finally(unsub);
    },
  });
  mountMemoryHealthBanner({
    subscribe: (cb) => getCompanion()?.onMemoryHealthStatus?.((s) => cb(s)) ?? (() => undefined),
    getStatus: () => getCompanion()?.getMemoryHealthStatus?.() ?? Promise.resolve(null),
  });

  // Phase 1 onboarding spine: a packaged app has no .env, so the working repo must be chosen once and
  // persisted by MAIN in userData/config.json. The native folder picker lives behind the preload bridge.
  mountWorkdirBanner({
    getConfig: () => getCompanion()?.getWorkdirConfig?.() ?? Promise.resolve({ source: 'unset' }),
    chooseWorkdir: () => getCompanion()?.chooseWorkdir?.() ?? Promise.resolve({ source: 'unset' }),
    onStatus: setStatus,
  });

  // Phase 1 polish: the first-run picker is not a one-way door. Settings reuses the same MAIN-owned
  // folder picker and broadcasts the same workdir-configured event so banners and turn gates stay coherent.
  mountProjectSettings({
    getConfig: () => getCompanion()?.getWorkdirConfig?.() ?? Promise.resolve({ source: 'unset' }),
    chooseWorkdir: () => getCompanion()?.chooseWorkdir?.() ?? Promise.resolve({ source: 'unset' }),
    onStatus: setStatus,
    isRunActive: () => runState.active,
    host: document.getElementById('controls') ?? undefined,
  });

  // M8: the transparency + Forget panel — see + delete the facts Roro knows about you (the trust
  // counterweight). Mount the toggle in #controls so it sits with the other header controls and is hidden
  // alongside them in floating mode; the panel itself positions as an overlay.
  mountForgetPanel(
    document.getElementById('controls') ?? undefined,
    config.memoryPanelSmoke ? createMemoryPanelSmokeDeps() : undefined,
  );

  // M9 (WS5): the cosmetics fake-door — OFF by default; the founder enables it (RORO_WS5_STORE=1) to run the
  // willingness-to-pay experiment. Intent is captured locally (console + a localStorage log the founder can
  // inspect); wire onIntent to real aggregation to run it live. NO payment path exists — it stops at intent.
  if (config.cosmeticsStore) {
    mountCosmeticsStore({
      host: document.getElementById('controls') ?? undefined,
      onIntent: (item) => {
        try {
          const key = 'roro.ws5.intent';
          const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
          const log = Array.isArray(parsed) ? parsed : []; // coerce — a corrupt/non-array value can't break logging
          log.push({ ...item, at: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(log));
        } catch { /* best-effort local log; console below is the primary signal */ }
        console.info('[WS5] cosmetic purchase intent:', item); // founder: forward to aggregation to run the experiment
      },
    });
  }

  // Aliveness: the cat watches the cursor (gaze eased toward the pointer). Gaze
  // ONLY — cursor movement must NOT keep the cat awake; poke is reserved for real
  // interactions (pet/summon/task), which is what makes idle->sleep reachable.
  getCompanion()?.onCursor?.((target) => driver.setGaze?.(target));

  if (config.floatingWindow) {
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', 'Pet or move Roro');
    canvas.title = 'Click or hold to pet Roro. Drag to move.';
    canvas.style.cursor = 'grab';
    // The cat's body carries ONLY affection + move (interaction spec §4.1). Talk
    // is no longer a body gesture — it moves to the menu/console (Phase B/C).
    installFloatingWindowGesture(canvas, {
      onPet: () => { driver.poke?.(); driver.pet?.(); },
    });
  }

  // Text-input path: feed a typed task straight to MAIN's orchestrator. It shares the same
  // accepted-turn Stop contract as floating Ask: no-id cancel before the run id is known, then
  // targeted cancel once turnRun resolves.
  mountTypedPrompt({
    captions,
    driver,
    brainGate,
    sessionId,
    setStatus,
  });

  if (config.debugBridge) {
    // Expose a tiny dev handle for manual testing in DevTools (drive the avatar without a model/keys).
    (window as unknown as { __companion?: unknown }).__companion = {
      driver,
      setState: (s: Parameters<typeof driver.setState>[0]) => driver.setState(s),
      setActivity: (cue: Parameters<typeof driver.setActivity>[0]) => driver.setActivity(cue),
      setMouthOpen: (v: number) => driver.setMouthOpen(v),
      setMuted: (v: boolean) => driver.setMuted(v),
      pet: () => driver.pet?.(),
      setEnergy: (energy: Parameters<typeof avatar.cat['debugSetEnergy']>[0]) => {
        avatar.cat.debugSetEnergy(energy);
      },
    };
  }
}

interface FloatingGestureHandlers {
  /** Affection — fired instantly on press, then repeated while held still. */
  onPet: () => void;
}

// The cat's body carries exactly two verbs (interaction spec §4.1): TAP/HOLD = pet
// (instant, then sustained), DRAG (past threshold) = move. No timer arbitrates
// between meanings, so nothing is ambiguous and a press can never start a call.
function installFloatingWindowGesture(
  canvas: HTMLCanvasElement,
  handlers: FloatingGestureHandlers,
): void {
  const dragThresholdPx = 6;
  const sustainedPetMs = 450; // keep petting while the press is held still
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let petTimer: ReturnType<typeof setInterval> | null = null;

  function stopPet(): void {
    if (petTimer !== null) {
      clearInterval(petTimer);
      petTimer = null;
    }
  }
  function resetGesture(): void {
    pointerId = null;
    dragging = false;
    stopPet();
    canvas.classList.remove('dragging');
    canvas.style.cursor = 'grab';
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ev.isPrimary || ev.button !== 0) return; // left button only
    pointerId = ev.pointerId;
    startX = lastX = ev.screenX;
    startY = lastY = ev.screenY;
    dragging = false;
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = 'grabbing';
    // Pet immediately (instant feedback, Law 1), then keep petting while held still
    // (sustained affection). A drag cancels the sustained pet (it's a move, not a pet).
    handlers.onPet();
    petTimer = setInterval(() => {
      if (!dragging) handlers.onPet();
    }, sustainedPetMs);
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (pointerId !== ev.pointerId) return;
    const totalDx = ev.screenX - startX;
    const totalDy = ev.screenY - startY;
    if (!dragging && Math.hypot(totalDx, totalDy) >= dragThresholdPx) {
      dragging = true;
      stopPet(); // a drag is a move, not petting
      canvas.classList.add('dragging');
    }
    if (!dragging) return;
    const dx = ev.screenX - lastX;
    const dy = ev.screenY - lastY;
    lastX = ev.screenX;
    lastY = ev.screenY;
    const companion = getCompanion();
    if (companion?.moveWindowBy) {
      void companion.moveWindowBy({ dx, dy });
    }
    ev.preventDefault();
  });

  canvas.addEventListener('pointerup', (ev) => {
    if (pointerId !== ev.pointerId) return;
    if (canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    resetGesture();
    ev.preventDefault();
  });

  canvas.addEventListener('pointercancel', (ev) => {
    if (pointerId !== ev.pointerId) return;
    resetGesture();
  });
}
