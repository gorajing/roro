import 'dotenv/config'; // MUST be first: populates process.env from ./.env before any module reads it.
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
import { loadBrain } from './main/siblings';
import { bootstrapFailureMessage, bootstrapStatusFor, type OllamaProbe } from './main/bootstrapPlan';
import type { BootstrapStatusMsg } from './shared/ipc';
import { ollamaTags } from './brain/ollama';
import { CH } from './shared/ipc';

/**
 * Startup self-check for the (local-first) brain: confirm the provider is reachable and the models are
 * present BEFORE the first turn, so a down daemon / missing model surfaces at boot, not mid-task.
 * FAIL LOUD but NON-BLOCKING: we never prevent the window from rendering (that would make the app look
 * dead and couples startup to Ollama being up). On failure we log loudly AND push a diagnostic caption
 * to the renderer once it's loaded, so the user sees WHY turns won't work (e.g. run `ollama serve`).
 */
// The last computed first-run readiness — served on demand via CH.bootstrapStatusGet so the renderer can
// RECOVER a push it missed (it subscribes only after its async character load; the push fires on
// did-finish-load, which can land first). Registered in whenReady.
let lastBootstrapStatus: BootstrapStatusMsg | null = null;

async function verifyBrainAtStartup(win: BrowserWindow): Promise<void> {
  try {
    const brain = await loadBrain();
    const result = await brain.preflight();
    console.log(`[main] brain preflight OK — ${brain.describeBrain()}; models:`, result.required);
    lastBootstrapStatus = { ready: true, needsOllamaInstall: false, missing: [], essentialBytes: 0 };
  } catch (err) {
    const baseMessage = `Local brain unavailable: ${(err as Error).message}`;
    console.error(`[main] brain preflight FAILED — ${baseMessage}`);
    // Turn the failure into ACTIONABLE first-run guidance (M7): for the local-Ollama provider, probe whether
    // the daemon is up + which models it has, then disclose exactly what to install + the honest core-loop size
    // (~2GB essentials, not the full ~8GB). A nebius failure is a cloud-key issue — skip the (pointless) probe.
    let message = baseMessage;
    let status: BootstrapStatusMsg | null = null;
    if (process.env.BRAIN_PROVIDER !== 'nebius') {
      let probe: OllamaProbe;
      try {
        probe = { kind: 'reachable', models: await ollamaTags() };
      } catch (e) {
        // A TIMEOUT means the daemon is up but wedged (reinstalling won't help — keep the accurate message);
        // any other failure (connection refused) means it isn't running. ollamaFetchError tags timeouts.
        probe = /timed out/i.test((e as Error)?.message ?? '') ? { kind: 'degraded' } : { kind: 'unreachable' };
      }
      message = bootstrapFailureMessage(baseMessage, 'ollama', probe);
      status = bootstrapStatusFor(probe); // structured status → the renderer's one-click download banner (M7b)
    }
    lastBootstrapStatus = status; // serve it on demand (race recovery), in addition to the push below
    const send = (): void => {
      win.webContents.send(CH.actionEvent, { kind: 'message', runId: 'preflight', text: `⚠️ ${message}`, ts: Date.now() });
      if (status) win.webContents.send(CH.bootstrapStatus, status);
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
// an env var so it is OFF for normal/demo runs; launch with RORO_DEBUG_PORT=9223
// to attach a CDP client to the renderer. Must be set before app 'ready'.
if (process.env.RORO_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.RORO_DEBUG_PORT);
}

// IPC handlers are stateless and safe to register before windows exist.
registerIpcHandlers();
// Serve the last bootstrap status on demand (M7b) so a renderer that subscribed late can recover it.
ipcMain.handle(CH.bootstrapStatusGet, (): BootstrapStatusMsg | null => lastBootstrapStatus);

app.whenReady().then(async () => {
  // 0. Device-stable owner_id — the memory spine. Must exist before any turn runs. The local
  //    PGlite store lives beside owner.json in userData (single-writer, owned by main only).
  process.env.RORO_DB_DIR ||= join(app.getPath('userData'), 'memory');
  await initOwnerId();

  // 0b. Memory-at-rest readiness: encrypted memory wraps its data key with the OS keychain (safeStorage).
  //     Log it at boot so a keychain failure is visible BEFORE the first lazy memory op fails loud — e.g.
  //     an invalidly-signed packaged build makes the Keychain return errSecAuthFailed → false here.
  const { safeStorage } = await import('electron');
  console.log(`[main] memory-at-rest: safeStorage.isEncryptionAvailable() = ${safeStorage.isEncryptionAvailable()}`);

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
