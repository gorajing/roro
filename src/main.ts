import './main/processOutputGuard'; // MUST be first: broken stdout/stderr pipes must not crash Electron.
import 'dotenv/config'; // Populates process.env from ./.env before app modules read it.
import './shared/env-migrate'; // back-compat: COMPANION_* -> RORO_* BEFORE any module reads env at load.
// src/main.ts — Electron MAIN process entry. Boots a secure window, registers all typed IPC,
// and a summon shortcut.
//
// The mic/TCC gate + Chromium media-permission handlers were voice-only and left with the voice
// stack (packages/voice) — nothing app-side touches the microphone. See packages/voice/README.md
// for the re-integration checklist (mic IPC, TCC prompt ordering, permission handlers).
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

import { guardDeferredEnv } from './shared/releaseChannel';
import { registerPlatformPorts } from './main/platformPorts';
import { registerIpcHandlers } from './main/ipc';
import { createWindow, registerSummonShortcut, unregisterShortcuts, startCursorTracking } from './main/window';
import { cancelAllRuns } from './main/orchestrator';
import { cancelAllProposers } from './main/factProposals/runner';
import { destroyPointerOverlay } from './main/pointerOverlay';
import { getPetWindow } from './main/windowRegistry';
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

// Optional Chromium remote-debugging port for end-to-end UI testing. Gated behind
// an env var so it is OFF for normal/demo runs; launch with RORO_DEBUG_PORT=9223
// to attach a CDP client to the renderer. Must be set before app 'ready'.
if (process.env.RORO_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.RORO_DEBUG_PORT);
}

// Bind the core's platform ports to their Electron implementations BEFORE anything that can reach the
// core (IPC handlers, turns). Fail-loud if a core path runs before this: an unregistered port throws.
registerPlatformPorts();
// IPC handlers are stateless and safe to register before windows exist.
registerIpcHandlers();
// Serve the last bootstrap status on demand (M7b) so a renderer that subscribed late can recover it.
ipcMain.handle(CH.bootstrapStatusGet, (): BootstrapStatusMsg | null => getBootstrapStatus());

app.whenReady().then(async () => {
  // 0. Device-stable owner_id — the memory spine. Must exist before any turn runs. The local
  //    memory2 store (files + derived index) lives beside owner.json in userData (single-writer,
  //    owned by main only).
  process.env.RORO_DB_DIR ||= join(app.getPath('userData'), 'memory');
  await hydrateWorkdirConfig(app.getPath('userData'));
  const ownerId = await initOwnerId(app.getPath('userData'));

  // 1. Secure window + summon shortcut.
  // Tear the pointing overlay down whenever the main window closes, so the transparent, click-through
  // overlay never lingers in BrowserWindow.getAllWindows() — otherwise it would block `window-all-closed`
  // (non-macOS), suppress dock re-creation on `activate`, and let first-window sends/shortcuts target it.
  const withOverlayCleanup = (w: BrowserWindow): BrowserWindow => {
    w.on('closed', () => destroyPointerOverlay());
    return w;
  };
  const win = withOverlayCleanup(createWindow());
  startCursorTracking(win);
  registerSummonShortcut();

  // 2. Memory warmup: initialize the keychain + memory store shortly after first paint, off the first-turn path.
  //    Non-blocking — a very fast first turn still degrades independently if memory is unavailable, while
  //    the common path gets a warmed store without delaying the packaged renderer target.
  if (memoryWarmupDisabled(guardDeferredEnv(process.env))) {
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

  // 3. Brain self-check (local-first): verify Ollama/models up-front. Non-blocking — never gates the
  //    window; logs + surfaces a renderer diagnostic on failure (see verifyBrainAtStartup).
  void verifyBrainAtStartup(win);

  app.on('activate', () => {
    // macOS: re-create the pet when the dock icon is clicked and no PET window exists.
    // Checked via the registry, not getAllWindows().length — a lingering overlay must never
    // suppress dock re-creation.
    if (!getPetWindow()) {
      withOverlayCleanup(createWindow());
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
  cancelAllProposers();
  destroyPointerOverlay();
});
