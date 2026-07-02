// src/main/platformPorts.ts — the shell adapter that wires the core's platform ports to Electron.
//
// This is the ONE place the Electron-free core's platform needs are bound to their real
// implementations. main.ts calls registerPlatformPorts() at module scope (before registerIpcHandlers),
// so every port is live before the first turn. windowRegistry/safeSend stay shell: the core's knowledge
// of "the pet window" reduces to a push function here.
import { Notification } from 'electron';
import { setPlatformPorts } from '../core/ports/ports';
import { sendToPetWindow } from './safeSend';

/** Bind the core platform ports to their Electron implementations. Call once at boot. */
export function registerPlatformPorts(): void {
  setPlatformPorts({
    // Guarded MAIN->renderer push to the pet window (registry-targeted).
    rendererPush: {
      send: (channel, ...args) => sendToPetWindow(channel, ...args),
    },
    // Native OS notification. The core owns notifyJobDone's product logic; the shell wraps the two
    // Electron calls (support probe + show).
    notification: {
      isSupported: () => Notification.isSupported(),
      show: ({ title, body }) => { new Notification({ title, body }).show(); },
    },
    // Desktop pointer overlay. Lazy-imported so the overlay module (which creates a BrowserWindow) is
    // loaded on first point — the laziness the orchestrator's dynamic import used to provide.
    pointerOverlay: {
      showPointForBox: async (box, confidence) => {
        const { showPointForBox } = await import('./pointerOverlay');
        await showPointForBox(box, confidence);
      },
    },
  });
}
