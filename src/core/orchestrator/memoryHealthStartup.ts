import { CH } from '../../shared/ipc';
import type { MemoryModule } from './siblings';
import { memoryHealthChecking, memoryHealthFailureFromError, memoryHealthOk, setMemoryHealthStatus } from './memoryHealthStatusStore';

export interface MemoryHealthWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    mainFrame?: {
      isDestroyed(): boolean;
      detached?: boolean;
      send(channel: string, payload: unknown): void;
    };
  };
}

function pushMemoryHealth(win: MemoryHealthWindow, status: unknown): void {
  try {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    const frame = win.webContents.mainFrame;
    if (!frame || frame.isDestroyed() || frame.detached) return;
    frame.send(CH.memoryHealthStatus, status);
  } catch {
    /* best-effort diagnostic push; the stored status remains fetchable */
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function warmMemoryHealthAtStartup(opts: {
  ownerId: string;
  win: MemoryHealthWindow;
  loadMemory: () => Promise<Pick<MemoryModule, 'profileFacts'>>;
  log?: Pick<Console, 'log' | 'error'>;
}): Promise<void> {
  const { ownerId, win, loadMemory, log = console } = opts;
  const checking = memoryHealthChecking();
  setMemoryHealthStatus(checking);
  pushMemoryHealth(win, checking);
  try {
    const memory = await loadMemory();
    await memory.profileFacts(ownerId);
    const status = memoryHealthOk();
    setMemoryHealthStatus(status);
    pushMemoryHealth(win, status);
    log.log('[main] memory warmup OK');
  } catch (err) {
    const status = memoryHealthFailureFromError(err);
    setMemoryHealthStatus(status);
    pushMemoryHealth(win, status);
    log.error(`[main] memory warmup FAILED — ${describeError(err)}`);
  }
}
