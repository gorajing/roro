// src/main/window.ts — secure BrowserWindow creation + the summon/focus globalShortcut.
//
// Security posture (locked per BUILD_GUIDE step 2): contextIsolation ON, sandbox ON,
// nodeIntegration OFF. The renderer reaches MAIN only through the preload contextBridge.
// The MAIN_WINDOW_VITE_* magic constants are injected by @electron-forge/plugin-vite and
// typed via forge.env.d.ts — do NOT redeclare them.
import { BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CH } from '../shared/ipc';
import { cursorToGazeTarget } from '../shared/gaze';
import { decideSummonAction } from './summon';
import { withCrossOriginIsolation } from './crossOriginIsolation';
import { isSafeNavigation } from './navigation';
import { sendToWindow } from './safeSend';
import { voiceRuntimeEnabled } from './voiceFlags';

const SUMMON_ACCELERATOR = 'CommandOrControl+Shift+Space';
const MUTE_ACCELERATOR = 'CommandOrControl+Shift+M';
const FLOATING_WINDOW_FLAG = process.env.RORO_FLOATING_WINDOW === '1';
const VOICE_RUNTIME_ENABLED = voiceRuntimeEnabled(process.env);
const FLOATING_WINDOW_SIZE = {
  width: 380,
  height: 400,
} as const;
const FLOATING_WINDOW_ASPECT_RATIO = FLOATING_WINDOW_SIZE.width / FLOATING_WINDOW_SIZE.height;

export function createWindow(): BrowserWindow {
  // Renderer-safe runtime config, sourced from MAIN's process.env (populated by dotenv in src/main.ts).
  // Only non-secret values cross into the renderer; private keys stay in MAIN. Passed via additionalArguments
  // (a single argv element — these values contain no spaces).
  const roroCfg = {
    modelUrl: process.env.LIVE2D_MODEL_URL ?? '',
    floatingWindow: FLOATING_WINDOW_FLAG,
    // On-device voice dev flags — the renderer's only activation path (config.ts reads window.RORO_CFG, and
    // its viteEnv() is a deliberate no-op). RORO_STT_VOICE=1 npm start → real VAD + whisper STT; RORO_VAD_VOICE
    // → VAD ear-perk only; RORO_FAKE_VOICE → scripted engine (no mic/models). All default off.
    fakeVoice: process.env.RORO_FAKE_VOICE === '1',
    vadVoice: process.env.RORO_VAD_VOICE === '1',
    sttVoice: process.env.RORO_STT_VOICE === '1',
    ttsVoice: process.env.RORO_TTS_VOICE === '1',
    voicePack: process.env.RORO_VOICE_PACK ?? '',
    // WS5 validation (M9): the cosmetics fake-door, OFF by default — RORO_WS5_STORE=1 to run the experiment.
    cosmeticsStore: process.env.RORO_WS5_STORE === '1',
  };

  const mainWindow = new BrowserWindow({
    title: 'Roro',
    width: FLOATING_WINDOW_FLAG ? FLOATING_WINDOW_SIZE.width : 1024,
    height: FLOATING_WINDOW_FLAG ? FLOATING_WINDOW_SIZE.height : 768,
    frame: !FLOATING_WINDOW_FLAG,
    transparent: FLOATING_WINDOW_FLAG,
    backgroundColor: FLOATING_WINDOW_FLAG ? '#00000000' : '#0e1018',
    hasShadow: !FLOATING_WINDOW_FLAG,
    acceptFirstMouse: FLOATING_WINDOW_FLAG,
    alwaysOnTop: FLOATING_WINDOW_FLAG,
    fullscreenable: !FLOATING_WINDOW_FLAG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // compiled name is .js
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--roro-cfg=' + JSON.stringify(roroCfg)],
    },
  });

  if (FLOATING_WINDOW_FLAG) {
    mainWindow.setAspectRatio(FLOATING_WINDOW_ASPECT_RATIO);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setFullScreenable(false);
  }

  // ---- Security: lock the renderer to its OWN document. The renderer holds the full privileged
  // bridge (incl. companion.runTask -> a workspace-write coding agent); a navigation or window.open
  // to an attacker origin would inherit it. Deny ALL new windows + webviews, and permit navigation
  // only to the app's own document (isSafeNavigation). Set BEFORE load so nothing slips through.
  const indexFile = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || pathToFileURL(indexFile).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSafeNavigation(url, appUrl)) {
      event.preventDefault();
      console.warn('[security] blocked renderer navigation to', url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // Cross-origin isolation: COOP same-origin + COEP credentialless on the renderer's responses, so the
  // on-device voice WASM (whisper/Silero/Kokoro) can use SharedArrayBuffer + threads (the ~3x threaded-SIMD
  // path, not slow single-thread). credentialless keeps the first-run model downloads working. Set on the
  // window's session BEFORE load so the document itself is isolated.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: withCrossOriginIsolation(details.responseHeaders) });
  });

  // Keep the template's MAIN_WINDOW_VITE_* loading logic (dev server vs packaged file).
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(indexFile);
  }

  return mainWindow;
}

const CURSOR_POLL_MS = 90;
// Pixel distance from the window centre at which the gaze is fully deflected.
const CURSOR_REACH_PX = 520;

/**
 * Poll the global cursor and push a normalized gaze target to the renderer so
 * the cat can "watch" the pointer. Returns a stop fn; also self-stops on close.
 */
export function startCursorTracking(win: BrowserWindow): () => void {
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped) return;
    if (win.isDestroyed()) return stop();
    if (win.webContents.isDestroyed()) return stop();
    if (!win.isVisible() || win.isMinimized()) return;
    const cursor = screen.getCursorScreenPoint();
    const target = cursorToGazeTarget(cursor, win.getBounds(), CURSOR_REACH_PX);
    sendToWindow(win, CH.cursorMove, target);
  }, CURSOR_POLL_MS);
  win.once('close', stop);
  win.once('closed', stop);
  win.webContents.once('destroyed', stop);
  win.webContents.once('render-process-gone', stop);
  return stop;
}

/**
 * Register the global summon/toggle shortcut. register() returns false (does not throw)
 * if the accelerator is already taken — we log loud on failure. Call after whenReady.
 */
export function registerSummonShortcut(): void {
  const summonOk = globalShortcut.register(SUMMON_ACCELERATOR, () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const action = decideSummonAction({
      visible: win.isVisible(),
      focused: win.isFocused(),
      floating: FLOATING_WINDOW_FLAG,
    });
    if (action === 'hide') {
      win.hide();
    } else if (action === 'show-and-focus-ask') {
      // ⌘⇧Space is a deliberate "I want to type a task" — the window must become KEY or the
      // renderer's input.focus() won't receive keystrokes (a showInactive window isn't key, so
      // typing would land in the previously focused app). Take focus, then open + focus the Ask.
      win.show();
      win.focus();
      sendToWindow(win, CH.focusAsk);
    } else {
      win.show();
      win.focus();
    }
  });
  if (!summonOk) {
    console.error(
      `[main] globalShortcut '${SUMMON_ACCELERATOR}' registration failed (already taken)`,
    );
  }

  if (VOICE_RUNTIME_ENABLED) {
    const muteOk = globalShortcut.register(MUTE_ACCELERATOR, () => {
      for (const win of BrowserWindow.getAllWindows()) {
        sendToWindow(win, CH.micToggleMute);
      }
    });
    if (!muteOk) {
      console.error(
        `[main] globalShortcut '${MUTE_ACCELERATOR}' registration failed (already taken)`,
      );
    }
  }
}

/** Unregister all global shortcuts (call on will-quit). */
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
