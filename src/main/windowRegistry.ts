// src/main/windowRegistry.ts — the ONE registry of roro's product (pet) window.
//
// MAIN->renderer pushes and global shortcuts must target the PET window BY NAME, never
// "the first window": BrowserWindow.getAllWindows() orders newest-first, so the moment a
// second window exists (the pointer overlay — preload-less, invisible, click-through) it
// becomes index 0 and every push silently lands on a surface with no listeners while the
// pet UI starves. Registration makes the target explicit and un-hijackable.

import type { BrowserWindow } from 'electron';

let petWindow: BrowserWindow | null = null;

/** Register the product window. The registry self-clears when that window closes. */
export function registerPetWindow(win: BrowserWindow): void {
  petWindow = win;
  win.on('closed', () => {
    // Only clear if a newer window hasn't replaced this one (activate re-creates the pet).
    if (petWindow === win) petWindow = null;
  });
}

/** The live pet window, or null once it is closed/destroyed. */
export function getPetWindow(): BrowserWindow | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  return petWindow;
}

export const __test = {
  reset(): void {
    petWindow = null;
  },
};
