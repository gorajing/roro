// src/main/safeSend.ts — guarded MAIN->renderer push IPC.
import { BrowserWindow } from 'electron';

export function sendToWindow(win: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): boolean {
  if (!win || win.isDestroyed()) return false;
  try {
    const contents = win.webContents;
    if (contents.isDestroyed()) return false;
    const frame = contents.mainFrame;
    if (frame.isDestroyed() || frame.detached) return false;
    frame.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}

export function sendToFirstWindow(channel: string, ...args: unknown[]): boolean {
  return sendToWindow(BrowserWindow.getAllWindows()[0], channel, ...args);
}
