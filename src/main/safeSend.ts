// src/main/safeSend.ts — guarded MAIN->renderer push IPC.
import type { BrowserWindow, WebContents } from 'electron';

import { getPetWindow } from './windowRegistry';

export function sendToWebContents(contents: WebContents | null | undefined, channel: string, ...args: unknown[]): boolean {
  if (!contents) return false;
  try {
    if (contents.isDestroyed()) return false;
    const frame = contents.mainFrame;
    if (!frame || frame.isDestroyed() || frame.detached) return false;
    frame.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}

export function sendToWindow(win: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): boolean {
  if (!win || win.isDestroyed()) return false;
  return sendToWebContents(win.webContents, channel, ...args);
}

/**
 * Push to the PET window via the registry — NEVER BrowserWindow.getAllWindows()[0]:
 * getAllWindows() orders newest-first, so any second window (the pointer overlay) would
 * silently swallow every push the moment it exists.
 */
export function sendToPetWindow(channel: string, ...args: unknown[]): boolean {
  return sendToWindow(getPetWindow(), channel, ...args);
}
