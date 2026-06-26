// src/main/safeSend.ts — guarded MAIN->renderer push IPC.
import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';

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

export function sendToFirstWindow(channel: string, ...args: unknown[]): boolean {
  return sendToWindow(BrowserWindow.getAllWindows()[0], channel, ...args);
}
