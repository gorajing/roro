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
import { isSafeNavigation } from './navigation';
import { sendToWindow } from './safeSend';
import { getPetWindow, registerPetWindow } from './windowRegistry';
import { guardDeferredEnv } from '../shared/releaseChannel';

const SUMMON_ACCELERATOR = 'CommandOrControl+Shift+Space';
// roro is a floating desktop pet by DEFAULT: a transparent, frameless, always-on-top window you can
// drag anywhere on screen (see the BrowserWindow options below + the renderer drag gesture). Setting
// RORO_FLOATING_WINDOW=0 opts back into the legacy opaque 1024x768 framed dev window, which the typed-prompt
// path and the packaged smokes rely on. Any value other than '0' (incl. unset) keeps the floating pet.
// Window mode is NOT a deferred-v0 flag, so it is read straight from process.env (not guardDeferredEnv).
const FLOATING_WINDOW_FLAG = process.env.RORO_FLOATING_WINDOW !== '0';
const FLOATING_WINDOW_SIZE = {
  width: 190,
  height: 200,
} as const;
const FLOATING_WINDOW_ASPECT_RATIO = FLOATING_WINDOW_SIZE.width / FLOATING_WINDOW_SIZE.height;
// Inset (px) from the work-area edges when roro spawns in the bottom-left corner.
const SPAWN_MARGIN_PX = 16;

export function createWindow(): BrowserWindow {
  // Renderer-safe runtime config, sourced from MAIN's process.env (populated by dotenv in src/main.ts).
  // Only non-secret values cross into the renderer; private keys stay in MAIN. Passed via additionalArguments
  // (a single argv element — these values contain no spaces).
  // Every deferred-v0 flag below is read through guardDeferredEnv: on a release/cohort build it is
  // refused (the env key is stripped), so a cohort tester can never reach the cosmetics fake-door or
  // the debug bridge — regardless of launch env. On dev/smoke builds it passes through.
  const env = guardDeferredEnv(process.env);
  const roroCfg = {
    floatingWindow: FLOATING_WINDOW_FLAG, // not deferred-v0 (window mode); read straight from process.env
    // NO voice keys by construction: the on-device voice stack lives in packages/voice, outside the app's
    // dependency graph — RORO_*_VOICE env vars have no reader here (smoke-release-channel asserts absence).
    // WS5 validation (M9): the cosmetics fake-door, OFF by default — RORO_WS5_STORE=1 to run the experiment.
    cosmeticsStore: env.RORO_WS5_STORE === '1',
    // Dev/security escape hatch: exposes direct brain/vision/debug handles only when deliberately enabled.
    debugBridge: env.RORO_DEBUG_BRIDGE === '1',
    // Test-only renderer lifecycle harness used by npm run verify:floating; never enabled for default launches.
    floatingSmoke: env.RORO_FLOATING_SMOKE === '1',
    // Test-only Memory panel keyboard/a11y harness. Renderer-only; default launches use the real preload bridge.
    memoryPanelSmoke: env.RORO_MEMORY_PANEL_SMOKE === '1',
  };

  // roro spawns in the bottom-left corner of the primary display's WORK AREA — which excludes the macOS
  // menu bar + Dock, so the window rests just above the Dock rather than clipped behind it. Computed here
  // inside createWindow (not at module scope): screen.* is only valid after app 'ready', and createWindow
  // runs inside app.whenReady (src/main.ts). The clamp keeps the top edge on-screen on short displays.
  const winW = FLOATING_WINDOW_FLAG ? FLOATING_WINDOW_SIZE.width : 1024;
  const winH = FLOATING_WINDOW_FLAG ? FLOATING_WINDOW_SIZE.height : 768;
  let spawn: { x: number; y: number } | undefined;
  if (FLOATING_WINDOW_FLAG) {
    const { x: waX, y: waY, height: waH } = screen.getPrimaryDisplay().workArea;
    spawn = { x: waX + SPAWN_MARGIN_PX, y: Math.max(waY, waY + waH - winH - SPAWN_MARGIN_PX) };
  }

  const mainWindow = new BrowserWindow({
    title: 'Roro',
    width: winW,
    height: winH,
    ...(spawn ?? {}),
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
  // Register as THE pet window: every MAIN->renderer push (safeSend.sendToPetWindow) and the
  // summon shortcut resolve their target here, so a second window (the pointer overlay) can
  // never intercept them. Registration self-clears on close; activate re-registers.
  registerPetWindow(mainWindow);

  if (FLOATING_WINDOW_FLAG) {
    mainWindow.setAspectRatio(FLOATING_WINDOW_ASPECT_RATIO);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setFullScreenable(false);
  }

  // ---- Security: lock the renderer to its OWN document. The renderer holds a privileged
  // product bridge; a navigation or window.open
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

  // NOTE: the COOP/COEP cross-origin-isolation headers existed ONLY for the on-device voice WASM
  // (SharedArrayBuffer + threaded SIMD). Voice moved to packages/voice; nothing left in the renderer
  // needs crossOriginIsolated (the memory index runs in-process in MAIN). Re-enable per packages/voice/README.md.

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
    // The registry, never getAllWindows()[0]: the pointer overlay orders FIRST while it exists,
    // and summoning an invisible click-through window would strand the user.
    const win = getPetWindow();
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
}

/** Unregister all global shortcuts (call on will-quit). */
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
