import 'dotenv/config'; // MUST be first: populates process.env from ./.env before any module reads it.
// src/main.ts — Electron MAIN process entry. Boots a secure window, gates the macOS mic via
// TCC, installs Chromium permission handlers, registers all typed IPC, and a summon shortcut.
//
// Ordering matters: session permission handlers + the mic TCC prompt run INSIDE whenReady,
// BEFORE the window is created, so the renderer's getUserMedia is never raced/denied.
console.log('[main] env loaded, VAPI_PUBLIC_KEY set:', Boolean(process.env.VAPI_PUBLIC_KEY));
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import started from 'electron-squirrel-startup';

import { ensureMicAccess, installPermissionHandlers } from './main/mic';
import { registerIpcHandlers } from './main/ipc';
import { createWindow, registerSummonShortcut, unregisterShortcuts, startCursorTracking } from './main/window';
import { cancelAllRuns } from './main/orchestrator';
import { initOwnerId } from './main/identity';
import { loadBrain } from './main/siblings';
import { CH } from './shared/ipc';

/**
 * Startup self-check for the (local-first) brain: confirm the provider is reachable and the models are
 * present BEFORE the first turn, so a down daemon / missing model surfaces at boot, not mid-task.
 * FAIL LOUD but NON-BLOCKING: we never prevent the window from rendering (that would make the app look
 * dead and couples startup to Ollama being up). On failure we log loudly AND push a diagnostic caption
 * to the renderer once it's loaded, so the user sees WHY turns won't work (e.g. run `ollama serve`).
 */
async function verifyBrainAtStartup(win: BrowserWindow): Promise<void> {
  try {
    const brain = await loadBrain();
    const result = await brain.preflight();
    console.log(`[main] brain preflight OK — ${brain.describeBrain()}; models:`, result.required);
  } catch (err) {
    const message = `Local brain unavailable: ${(err as Error).message}`;
    console.error(`[main] brain preflight FAILED — ${message}`);
    const send = (): void => {
      win.webContents.send(CH.actionEvent, { kind: 'message', runId: 'preflight', text: `⚠️ ${message}`, ts: Date.now() });
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Optional Chromium remote-debugging port for end-to-end UI testing. Gated behind
// an env var so it is OFF for normal/demo runs; launch with COMPANION_DEBUG_PORT=9223
// to attach a CDP client to the renderer. Must be set before app 'ready'.
if (process.env.COMPANION_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.COMPANION_DEBUG_PORT);
}

// IPC handlers are stateless and safe to register before windows exist.
registerIpcHandlers();

app.whenReady().then(async () => {
  // 0. Device-stable owner_id — the memory spine. Must exist before any turn runs. The local
  //    PGlite store lives beside owner.json in userData (single-writer, owned by main only).
  process.env.COMPANION_DB_DIR ||= join(app.getPath('userData'), 'memory');
  await initOwnerId();

  // 1. Chromium-level media permission grant for the renderer's getUserMedia (request+check).
  installPermissionHandlers();

  // 2. macOS TCC mic consent up-front (surfaces the system prompt before any Vapi call).
  const micStatus = await ensureMicAccess();
  if (micStatus !== 'granted') {
    console.warn(
      `[main] microphone access is '${micStatus}'. The renderer must prompt the user to ` +
        `enable it in System Settings and relaunch.`,
    );
  }

  // 3. Secure window + summon shortcut.
  const win = createWindow();
  startCursorTracking(win);
  registerSummonShortcut();

  // 4. Brain self-check (local-first): verify Ollama/models up-front. Non-blocking — never gates the
  //    window; logs + surfaces a renderer diagnostic on failure (see verifyBrainAtStartup).
  void verifyBrainAtStartup(win);

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS (menu bar stays active until Cmd+Q).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
  cancelAllRuns();
});
