// src/renderer/bootstrap.ts — wires the whole renderer together.
//
// Order:
//   1. load config (Live2D model path + on-device voice feature flags)
//   2. build the character (real Live2D model OR placeholder) on #live2d-canvas
//   3. subscribe to the executor ActionEvent stream + brain reasoning
//   4. bind the Mute control; optionally mount the on-device voice path (dev flags)
//
// There is no cloud-voice call. The default surface is the typed prompt path; the
// on-device voice path (Silero VAD + whisper STT + Kokoro TTS) mounts only behind
// RORO_*_VOICE flags. model.speak()/AudioContext still need a user gesture to unlock.

import { loadConfig } from './config';
import { sessionId } from './session';
import { createCharacter } from './character/driver';
import { CaptionPanel, ActionTimeline } from './character/captions';
import { subscribeActionEvents } from './events/actionEvents';
import { mountFloatingAsk } from './ask/floatingAsk';
import { mountConfirmChip } from './confirm/confirmChip';
import { mountForgetPanel } from './memory/forgetPanel';
import { mountCosmeticsStore } from './cosmetics/cosmeticsStore';
import { getCompanion } from './events/bridge';
import { runState } from './events/runState';
import { mountLocalVoiceMode } from './voice/mountLocalVoiceMode';
import { activateVoice } from './voice/voiceActivation';
import { createFakeVoiceEngine } from './voice/fakeVoiceEngine';
import { createVadVoiceEngine } from './voice/vadVoiceEngine';
import type { NativeVoiceEngine } from './voice/voiceLocalAdapter';
import type { VoiceModeState } from './voice/voiceModeState';
import type { KokoroSpeaker } from './voice/kokoroVoiceEngine';
import { createVoiceSelection, listVoicePacks } from './voice/voicePacks';
import type { CharacterDriver } from './character/types';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string): void {
  const s = el('status');
  if (s) s.textContent = text;
}

/**
 * Build the cat's MOUTH (Phase 3): the Kokoro speaker driving lip-sync through the driver. Dynamically
 * imports the Kokoro glue (transformers.js + model) so it only loads when ttsVoice is on. A dedicated 24kHz
 * AudioContext matches Kokoro's rate (no resample); it's resumed on each speak (the cat replies after the
 * user has interacted, so the autoplay gesture is satisfied). The LipSyncDriver adapts the driver: amplitude
 * → setMouthOpen (its always-on AmplitudeLipSync), and start/stop → setTalking (which rests the mouth to 0).
 */
async function buildKokoroSpeaker(
  driver: Pick<CharacterDriver, 'setTalking' | 'setMouthOpen'>,
  voiceId: () => string, // the selected voice-pack id, read per-utterance (Phase 5 cosmetic)
): Promise<KokoroSpeaker> {
  const { createKokoroVoiceEngine } = await import('./voice/kokoroVoiceEngine');
  const { synthStream } = await import('./voice/kokoroSynthesize');
  const ctx = new AudioContext({ sampleRate: 24000 });
  return createKokoroVoiceEngine({
    synthesize: (text, opts) => {
      void ctx.resume(); // idempotent; ensure the context is running before playback
      return synthStream(text, opts);
    },
    audio: ctx,
    lipSync: {
      start: () => driver.setTalking(true),
      stop: () => driver.setTalking(false),
      setAmplitude: (v) => driver.setMouthOpen(v),
    },
    voiceId,
  });
}

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  document.documentElement.classList.toggle('floating-window', config.floatingWindow);
  document.body.classList.toggle('floating-window', config.floatingWindow);

  const canvas = el<HTMLCanvasElement>('live2d-canvas');
  if (!canvas) {
    console.error('[bootstrap] #live2d-canvas not found');
    return;
  }

  // 1 + 2: character (resolves even with no model — placeholder path).
  const { driver, hasModel } = await createCharacter(canvas, config.modelUrl);
  setStatus(hasModel ? 'Model loaded.' : 'No Live2D model — placeholder mode. See public/live2d/README.');

  // 3: captions + timeline + executor/brain subscriptions.
  const captions = new CaptionPanel();
  const timeline = new ActionTimeline();
  subscribeActionEvents({ character: driver, timeline, captions });

  // Phase B: the floating Ask input + Stop pill (the typed magic-moment surface on the cat body).
  // Lives outside #overlay; only visible in floating mode. Its lifecycle rides the push stream.
  mountFloatingAsk({ driver, sessionId });

  // Phase C1: the destructive-confirm chip (a spoken/typed word can't approve `rm -rf`).
  mountConfirmChip();

  // M8: the transparency + Forget panel — see + delete the facts Roro knows about you (the trust
  // counterweight). Mount the toggle in #controls so it sits with the other header controls and is hidden
  // alongside them in floating mode; the panel itself positions as an overlay.
  mountForgetPanel(document.getElementById('controls') ?? undefined);

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

  // The Mute button is the only call-era control that survives: it drives the SHARED mic-mute state the
  // on-device voice path reads. Start/End-call were the legacy Vapi cloud surface and are gone.
  const muteBtn = el<HTMLButtonElement>('mute-btn');
  const voiceModeBtn = el<HTMLButtonElement>('voice-mode-btn');

  let micMuted = false;
  // Set by the local-voice block (below) when the on-device path is mounted, so the mic-mute toggle
  // reaches the engine's at-the-source mute gate (deaf cat — no ear-perk, no STT compute). undefined
  // when the on-device path isn't mounted (typed-only default).
  let localVoiceMute: ((muted: boolean) => void) | undefined;
  // Set by the local-voice block when the on-device engine mounts: toggles Voice Mode (off → probe + consent
  // + summon; on → unsummon). Undefined when no voice engine is built this session — the button then explains
  // how to enable it rather than being a dead control.
  let voiceToggle: (() => void) | undefined;

  const setMicMuted = (next: boolean, status?: string): void => {
    micMuted = next;
    driver.setMuted(next);
    localVoiceMute?.(next); // on-device path: mute the cat's ears at the source (no perk, no whisper)
    if (muteBtn) muteBtn.textContent = next ? 'Unmute' : 'Mute';
    setStatus(status ?? (next ? 'Roro mic muted. Judge-talk is ignored.' : 'Roro mic live.'));
  };

  if (config.floatingWindow) {
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', 'Start talking to Roro');
    canvas.title = 'Click or hold to pet Roro. Drag to move. Right-click or M to mute.';
    canvas.style.cursor = 'grab';
    // The cat's body carries ONLY affection + move (interaction spec §4.1). Talk
    // is no longer a body gesture — it moves to the menu/console (Phase B/C).
    installFloatingWindowGesture(canvas, {
      onPet: () => { driver.poke?.(); driver.pet?.(); },
    });
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      setMicMuted(!micMuted);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key.toLowerCase() !== 'm' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      ev.preventDefault();
      setMicMuted(!micMuted);
    });
  }

  getCompanion()?.onMicToggleMute?.(() => {
    setMicMuted(!micMuted);
  });

  muteBtn?.addEventListener('click', () => {
    setMicMuted(!micMuted);
  });

  voiceModeBtn?.addEventListener('click', () => {
    if (voiceToggle) voiceToggle();
    else setStatus('Voice isn’t enabled this session — relaunch with RORO_STT_VOICE=1 RORO_TTS_VOICE=1 npm start. (One-click voice install lands in a later update.)');
  });

  // Text-input path: feed a typed task straight to MAIN's orchestrator
  // (turnRun -> recall[memory2] -> decide[local Ollama] -> executor[Codex]). No mic,
  // no voice. ActionEvents stream back over the same subscribeActionEvents
  // wiring that drives the avatar, captions, and timeline.
  const promptForm = el<HTMLFormElement>('prompt-form');
  const promptInput = el<HTMLInputElement>('prompt-input');
  const sendBtn = el<HTMLButtonElement>('send-btn');
  const cancelBtn = el<HTMLButtonElement>('cancel-btn');

  // One turn at a time. A disabled submit button does NOT block the Enter key,
  // so re-entry is gated here — concurrent turns would scramble the shared
  // reasoning caption + button state.
  let turnInFlight = false;
  let cancelRequested = false;

  // Arm Stop ONLY once the coding agent actually starts: cancelTask can abort a
  // run only after the executor registers it. The pre-executor phase (Nebius
  // decide / vision) is bounded by the brain's own 60s timeout, so there's
  // nothing to abort there — enabling Stop then would be a lie.
  getCompanion()?.onActionEvent((e) => {
    if (e.kind === 'run.started') {
      driver.setBusy?.(true);
      if (cancelBtn) cancelBtn.disabled = false;
      setStatus('Coding agent running — click Stop to abort.');
    } else if (e.kind === 'run.completed') {
      driver.setBusy?.(false);
    } else if (e.kind === 'run.failed') {
      driver.setBusy?.(false);
    }
  });

  // Release the dev-form turn gate. Since turnRun now resolves at DISPATCH (not completion), the
  // turn ends on the universal runEnd push signal — not when the await returns. (Answer/clarify
  // turns have no run.completed; runEnd is the only end signal that fires for every turn.)
  const releaseDevTurn = (): void => {
    turnInFlight = false;
    if (sendBtn) sendBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;
    if (promptInput) promptInput.value = '';
  };

  getCompanion()?.onRunEnd?.(() => {
    if (!turnInFlight) return; // ignore runEnd for turns this dev form didn't start (e.g. floating Ask)
    setStatus(cancelRequested ? 'Stopped.' : 'Done — type another task.');
    releaseDevTurn();
  });

  promptForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (turnInFlight) return;
    const text = promptInput?.value.trim() ?? '';
    if (!text) return;

    const companion = getCompanion();
    if (!companion?.turnRun) {
      setStatus('Roro bridge unavailable (window.companion.turnRun missing).');
      return;
    }

    // Keep the typed task on screen for the whole run (cleared on runEnd).
    turnInFlight = true;
    cancelRequested = false;
    if (sendBtn) sendBtn.disabled = true;
    captions.update('user', text, true);
    driver.setState('thinking');
    setStatus('Thinking…');

    try {
      // Resolves at DISPATCH — this await only acks the handoff; it does NOT mean the turn is done
      // (and for an answer turn it may resolve AFTER runEnd, so setting any status here would race
      // and clobber the terminal "Done"). Status is fully stream-driven from here: run.started ->
      // "running", the universal runEnd -> "Done" (see the onRunEnd handler above).
      await companion.turnRun({ transcript: text, sessionId });
    } catch (e) {
      // turnRun normally returns {runId} even on a decide failure (it pushes run.failed + runEnd);
      // a throw here is an IPC-level failure, so no runEnd will arrive — release directly.
      driver.setState('error');
      setStatus(`Turn failed: ${describeError(e)}`);
      releaseDevTurn();
    }
  });

  cancelBtn?.addEventListener('click', async () => {
    const companion = getCompanion();
    if (!companion?.cancelTask) return;
    cancelRequested = true;
    setStatus('Stopping the agent…');
    try {
      await companion.cancelTask(); // no id => orchestrator aborts the latest (executor) run
    } catch (e) {
      setStatus(`Stop failed: ${describeError(e)}`);
    }
  });

  // The ON-DEVICE voice path (mouth-not-brain), behind dev flags until the full whisper/Silero/Kokoro
  // engine lands. Default (all flags off) mounts no voice surface — only the typed prompt path is live.
  if (config.sttVoice || config.vadVoice || config.ttsVoice || config.fakeVoice) {
    const c = getCompanion();
    // The on-device engine is composed from ears + transcript + mouth, each behind its own flag:
    //   vadVoice → REAL Silero VAD (Phase 1: ear-perk); sttVoice → + whisper STT (Phase 2: transcript);
    //   ttsVoice → + Kokoro TTS (Phase 3: the mouth). Any real flag mounts the VAD. else fakeVoice → a
    //   scripted engine. All glue is DYNAMICALLY imported here only, so its WASM + model loads never touch
    //   non-voice users or the fake path.
    const useRealVad = config.sttVoice || config.vadVoice || config.ttsVoice;
    const fakeEngine = useRealVad ? undefined : createFakeVoiceEngine();
    // Phase 5: the selected voice pack (only when the mouth is on). The engine reads voiceSel.current() per
    // utterance, so __roroVoice.setVoice switches mid-session. A bad config / set falls back to af_heart.
    const voiceSel = config.ttsVoice ? createVoiceSelection(config.voicePack) : undefined;
    let engine: NativeVoiceEngine;
    if (useRealVad) {
      const { createSileroVad } = await import('./voice/sileroVad');
      // createWhisperTranscribe() returns synchronously and warms the ~77MB base.en model in the BACKGROUND
      // (the ears are live immediately; only the first transcript awaits any remaining load). progress → status.
      const transcribe = config.sttVoice
        ? (await import('./voice/whisperTranscribe')).createWhisperTranscribe((p) => {
            if (p.status === 'progress') setStatus(`Loading speech model… ${Math.round(p.progress)}%`);
            // Consent-gated now: the mic is closed until the user clicks Voice Mode — don't say "speak".
            else if (p.status === 'ready') setStatus('Speech model ready — click 🎙 Voice Mode to talk to Roro.');
          })
        : undefined;
      const speaker = voiceSel ? await buildKokoroSpeaker(driver, () => voiceSel.current()) : undefined;
      engine = createVadVoiceEngine(createSileroVad, transcribe, speaker);
    } else {
      engine = fakeEngine!;
    }
    // Model ids — must match whisperTranscribe.ts / kokoroSynthesize.ts (and the staged public/models/ dirs).
    const STT_MODEL_ID = 'onnx-community/whisper-base.en';
    const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const want = { stt: config.sttVoice, tts: config.ttsVoice };

    // The HONEST FSM indicator: the button label, the mute button's enabled-ness, and the status line all
    // track the REAL Voice Mode state (never claim "listening" when the mic isn't open). Driven by
    // createVoiceMode's onState on every transition.
    const renderVoiceState = (s: VoiceModeState): void => {
      const on = s.mode !== 'off';
      if (voiceModeBtn) {
        voiceModeBtn.textContent = on ? '■ Stop voice' : '🎙 Voice Mode';
        voiceModeBtn.setAttribute('aria-pressed', String(on));
      }
      if (muteBtn) muteBtn.disabled = !on; // mute only matters while the mic is actually open
      setStatus(
        s.mode === 'hearing' ? 'Hearing you…'
          : s.mode === 'working' ? 'Working on it…'
            // Fake voice opens no real mic, so the mic-specific "speak" copy would lie — show the dev hint
            // for both its off and listening states.
            : fakeEngine
              ? 'Fake voice mode — in DevTools call __roroVoice.utter("add a logout route").'
              : s.mode === 'listening' ? "Voice Mode on — speak to Roro (the cat's ears perk ≤80ms)."
                : 'Voice Mode off — click 🎙 Voice Mode to talk to Roro.',
      );
    };

    const localVoice = mountLocalVoiceMode({
      engine,
      detect: () => true,
      deps: {
        // Return the bridge promise directly — when the bridge is MISSING this is undefined (non-thenable),
        // so the router doesn't latch a dispatch that would never see a runEnd (it stays unlatched).
        turnRun: (transcript) => c?.turnRun?.({ transcript, sessionId }),
        cancelTask: () => { void c?.cancelTask?.(); },
        isRunActive: () => runState.active,
        onRunEnd: (cb) => c?.onRunEnd?.(({ runId }) => cb(runId)) ?? (() => undefined),
      },
      onActionEvent: (cb) => c?.onActionEvent?.(cb) ?? (() => undefined),
      driver: { poke: () => driver.poke?.() },
      captions,
      onState: renderVoiceState,
      isMuted: () => micMuted,
    });
    localVoiceMute = (muted) => localVoice.setMuted(muted); // mic-mute toggle → engine's deaf-cat gate
    localVoice.setMuted(micMuted); // apply the current mute state at mount

    // Voice Mode is OPT-IN + consent-gated (no auto-summon). The button toggles it: off → probe (mic + staged
    // weights) → mic consent if undecided → open the mic; on → close it. Every refusal reports a reason.
    // `activating` guards the async start window: the FSM stays 'off' until summon() applies, so without it a
    // double-click would fire a second probe + consent prompt before the first resolved.
    let activating = false;
    voiceToggle = () => {
      if (localVoice.mode.state.mode !== 'off') {
        if (micMuted) setMicMuted(false); // each Voice Mode session starts live — mute is a within-session control
        void localVoice.mode.unsummon();
        return;
      }
      if (activating) { setStatus('Starting Voice Mode… one moment.'); return; } // acknowledge the impatient re-click
      activating = true;
      // Immediate, honest feedback: the mic-consent prompt + probe can take seconds, and the FSM stays 'off'
      // (so the button label can't flip) until summon() applies — without this the button looks dead meanwhile.
      setStatus('Starting Voice Mode…');
      void activateVoice({
        want,
        micStatus: async () => (await c?.mic?.status()) ?? 'unknown',
        requestMic: async () => (await c?.mic?.request()) ?? 'unknown',
        weightsPresent: async (which) => {
          const id = which === 'stt' ? STT_MODEL_ID : TTS_MODEL_ID;
          try {
            const res = await fetch(new URL(`models/${id}/config.json`, window.location.href).href, { method: 'HEAD' });
            return res.ok;
          } catch {
            // A same-origin static HEAD shouldn't throw; if it does, treat as "not staged" → the probe shows
            // the actionable stage-command blocker (fail-loud), never a silently dead button.
            return false;
          }
        },
        summon: () => localVoice.mode.summon(),
        report: (m) => setStatus(m),
      })
        // Backstop: any UNEXPECTED rejection (mic IPC, etc.) must surface, not become a silent unhandled
        // rejection that leaves the button looking dead. activateVoice already reports its own known failures.
        .catch((e) => setStatus(`Voice start error: ${describeError(e)} — the typed path still works.`))
        .finally(() => { activating = false; });
    };
    // The fake-voice path is a NO-MIC dev affordance (__roroVoice.utter): start it directly so utter() is live,
    // since the consent-gated button is only for the REAL on-device mic. Real engines stay button-gated.
    if (fakeEngine) void localVoice.mode.summon();
    renderVoiceState(localVoice.mode.state); // paint the initial state (button label + hint)
    (window as unknown as { __roroVoice?: unknown }).__roroVoice = {
      state: () => localVoice.mode.state,
      ...(voiceSel
        ? { setVoice: (id: string) => voiceSel.set(id), voice: () => voiceSel.current(), voices: () => listVoicePacks() }
        : {}),
      ...(fakeEngine ? { utter: (t: string) => fakeEngine.utter(t), spoken: () => fakeEngine.spoken } : {}),
    };
  }

  // Expose a tiny dev handle for manual testing in DevTools (drive the avatar
  // without a model/keys). Non-enumerable-ish; purely a debugging aid.
  (window as unknown as { __companion?: unknown }).__companion = {
    driver,
    setState: (s: Parameters<typeof driver.setState>[0]) => driver.setState(s),
    setActivity: (cue: Parameters<typeof driver.setActivity>[0]) => driver.setActivity(cue),
    setMouthOpen: (v: number) => driver.setMouthOpen(v),
    setMuted: (v: boolean) => setMicMuted(v),
  };
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
    if (!ev.isPrimary || ev.button !== 0) return; // left button only; right-click = mute/menu
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

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
