import './main/processOutputGuard'; // MUST be first: broken stdout/stderr pipes must not crash Electron.
import 'dotenv/config'; // Populates process.env from ./.env before app modules read it.
import './shared/env-migrate'; // back-compat: COMPANION_* -> RORO_* BEFORE any module reads env at load.
// src/main.ts — Electron MAIN process entry. Boots a secure window, gates the macOS mic via
// TCC, installs Chromium permission handlers, registers all typed IPC, and a summon shortcut.
//
// Ordering matters: session permission handlers + the mic TCC prompt run INSIDE whenReady,
// BEFORE the window is created, so the renderer's getUserMedia is never raced/denied.
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import started from 'electron-squirrel-startup';

import { ensureMicAccess, installPermissionHandlers } from './main/mic';
import { voiceMicNeeded } from './main/voiceFlags';
import { registerIpcHandlers } from './main/ipc';
import { createWindow, registerSummonShortcut, unregisterShortcuts, startCursorTracking } from './main/window';
import { cancelAllRuns } from './main/orchestrator';
import { initOwnerId } from './main/identity';
import { hydrateWorkdirConfig } from './main/configStore';
import { loadMemory } from './main/siblings';
import type { BootstrapStatusMsg } from './shared/ipc';
import { CH } from './shared/ipc';
import { sendToWindow } from './main/safeSend';
import { getBootstrapStatus } from './main/bootstrapStatusStore';
import { refreshBootstrapStatus } from './main/bootstrapRefresh';
import { warmMemoryHealthAtStartup } from './main/memoryHealthStartup';
import { memoryWarmupDisabled } from './main/memoryWarmupFlag';

const STARTUP_MEMORY_WARMUP_DELAY_MS = 3000;

/**
 * Startup self-check for the (local-first) brain: confirm the provider is reachable and the models are
 * present BEFORE the first turn, so a down daemon / missing model surfaces at boot, not mid-task.
 * FAIL LOUD but NON-BLOCKING: we never prevent the window from rendering (that would make the app look
 * dead and couples startup to Ollama being up). On failure we log loudly AND push a diagnostic caption
 * to the renderer once it's loaded, so the user sees WHY turns won't work (e.g. run `ollama serve`).
 */
async function verifyBrainAtStartup(win: BrowserWindow): Promise<void> {
  const result = await refreshBootstrapStatus();
  if (result.ok) {
    console.log(`[main] brain preflight OK — ${result.brainDescription}; models:`, result.required);
  } else {
    console.error(`[main] brain preflight FAILED — ${result.message}`);
  }
  const send = (): void => {
    if (!result.ok) {
      sendToWindow(win, CH.actionEvent, { kind: 'message', runId: 'preflight', text: `⚠️ ${result.message}`, ts: Date.now() });
    }
    sendToWindow(win, CH.bootstrapStatus, result.status);
  };
  if (!win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Optional Chromium remote-debugging port for end-to-end UI testing. Gated behind
// an env var so it is OFF for normal/demo runs; launch with RORO_DEBUG_PORT=9223
// to attach a CDP client to the renderer. Must be set before app 'ready'.
if (process.env.RORO_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.RORO_DEBUG_PORT);
}

// IPC handlers are stateless and safe to register before windows exist.
registerIpcHandlers();
// Serve the last bootstrap status on demand (M7b) so a renderer that subscribed late can recover it.
ipcMain.handle(CH.bootstrapStatusGet, (): BootstrapStatusMsg | null => getBootstrapStatus());

app.whenReady().then(async () => {
  // 0. Device-stable owner_id — the memory spine. Must exist before any turn runs. The local
  //    PGlite store lives beside owner.json in userData (single-writer, owned by main only).
  process.env.RORO_DB_DIR ||= join(app.getPath('userData'), 'memory');
  await hydrateWorkdirConfig();
  const ownerId = await initOwnerId();

  // 1. Chromium-level media permission grant for the renderer's getUserMedia (request+check).
  //    Cheap + promptless, so it is always installed; it only matters if voice later opens the mic.
  installPermissionHandlers();

  // 2. macOS TCC mic consent up-front — ONLY when an on-device voice flag that opens the mic is set.
  //    The default typed-only launch never touches the mic, so it must never surface the system prompt.
  if (voiceMicNeeded(process.env)) {
    const micStatus = await ensureMicAccess();
    if (micStatus !== 'granted') {
      console.warn(
        `[main] microphone access is '${micStatus}'. The renderer must prompt the user to ` +
          `enable it in System Settings and relaunch.`,
      );
    }
  }

  // 3. Secure window + summon shortcut.
  const win = createWindow();
  startCursorTracking(win);
  registerSummonShortcut();

  // 4. Memory warmup: initialize keychain/PGlite shortly after first paint, off the first-turn path.
  //    Non-blocking — a very fast first turn still degrades independently if memory is unavailable, while
  //    the common path gets a warmed store without delaying the packaged renderer target.
  if (memoryWarmupDisabled(process.env)) {
    console.log('[main] memory warmup skipped by RORO_DISABLE_MEMORY_WARMUP');
  } else {
    const warmMemory = (): void => {
      setTimeout(() => { void warmMemoryHealthAtStartup({ ownerId, win, loadMemory }); }, STARTUP_MEMORY_WARMUP_DELAY_MS);
    };
    if (!win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', warmMemory);
    } else {
      warmMemory();
    }
  }

  // 5. Brain self-check (local-first): verify Ollama/models up-front. Non-blocking — never gates the
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
