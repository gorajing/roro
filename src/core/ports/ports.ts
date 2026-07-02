// src/core/ports/ports.ts — the platform ports the Electron-free core reaches the shell through.
//
// The core (src/core — the six directories W7's atomic move carves out of the shell) holds ZERO
// electron imports. Every place it once reached a platform capability — pushing a MAIN->renderer
// message to the pet window, firing an OS notification, drawing the desktop pointer overlay, wrapping
// the memory DEK with the OS keychain — now goes through one of these narrow ports. The shell
// (src/main) supplies the Electron implementations once at boot via registerPlatformPorts
// (src/main/platformPorts.ts); tests supply capturing doubles via ./testing.installTestPorts.
//
// Access is fail-LOUD: reading a port before it is registered THROWS, naming the port — so a missing
// boot wiring surfaces immediately instead of degrading into a silent no-op.
import type { NormalizedBox } from '../../shared/pointing';
import type { SafeStorageLike } from '../memory2/safeStorageWrapper';

/** Push a guarded MAIN->renderer message to the pet window. Impl: safeSend.sendToPetWindow (registry-
 *  targeted — never getAllWindows()[0], which the pointer overlay would hijack). */
export interface RendererPushPort {
  send(channel: string, ...args: unknown[]): boolean;
}

/** Fire a native OS "job done" notification. Impl wraps electron Notification.isSupported() +
 *  new Notification(...).show(). The product logic (titles/truncation/best-effort) stays in core. */
export interface NotificationPort {
  isSupported(): boolean;
  show(notification: { title: string; body: string }): void;
}

/** Draw roro's paw at a grounded box on the desktop overlay. Impl: pointerOverlay.showPointForBox
 *  (the shell adapter keeps the lazy import so the overlay module loads on first point). */
export interface PointerOverlayPort {
  showPointForBox(box: NormalizedBox, confidence: number): Promise<void>;
}

/** Supply the raw OS-keychain object (Electron safeStorage) that wraps the memory DEK at rest. The core
 *  owns the KeyWrapper POLICY on top of it (buildSafeStorageWrapper + its Linux-backend/forced-failure
 *  rules stay in memory2); the shell hands over only the raw object. */
export interface KeyWrapperPort {
  getSafeStorage(): SafeStorageLike;
}

/** The full set the shell installs at boot. */
export interface PlatformPorts {
  rendererPush: RendererPushPort;
  notification: NotificationPort;
  pointerOverlay: PointerOverlayPort;
  keyWrapper: KeyWrapperPort;
}

let registered: PlatformPorts | null = null;

/** Install the platform port implementations. Called once at boot (shell adapter) or per-test
 *  (./testing.installTestPorts). Replaces the previous set wholesale. */
export function setPlatformPorts(ports: PlatformPorts): void {
  registered = ports;
}

function get<K extends keyof PlatformPorts>(key: K): PlatformPorts[K] {
  if (!registered) throw new Error(`[ports] ${key} not registered — call registerPlatformPorts at boot`);
  return registered[key];
}

// A single live accessor whose getters re-read the registry on every access (so a re-register or a
// test reset takes effect immediately). ports() returns it; core reads e.g. ports().rendererPush.send.
const accessor: PlatformPorts = {
  get rendererPush() { return get('rendererPush'); },
  get notification() { return get('notification'); },
  get pointerOverlay() { return get('pointerOverlay'); },
  get keyWrapper() { return get('keyWrapper'); },
};

/** The core's typed accessor for the platform ports. Fail-loud per-port when boot wiring is missing. */
export function ports(): PlatformPorts {
  return accessor;
}

/** Test-only: clear the registry so the next port access fails loud again (call in afterEach). */
export const __test = {
  reset(): void {
    registered = null;
  },
};
