import type { BootstrapStatusMsg } from '../../shared/ipc';

export interface BrainReadinessDeps {
  getStatus: () => Promise<BootstrapStatusMsg | null>;
  onStatus?: (text: string) => void;
}

export interface BrainReadinessGateDeps {
  subscribe: (cb: (status: BootstrapStatusMsg | null) => void) => () => void;
  getStatus: () => Promise<BootstrapStatusMsg | null>;
}

export interface BrainReadinessGate {
  canStartTurn(): boolean;
  ensureReady(onStatus?: (text: string) => void): boolean;
  current(): BootstrapStatusMsg | null;
  dispose(): void;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function describeBrainReadinessBlock(status: BootstrapStatusMsg): string {
  if (status.needsOllamaInstall) {
    return 'Start Ollama before asking Roro to code. Use the Get Ollama banner, then try again.';
  }
  if (status.missing.length > 0) {
    return 'Download Roro\'s core models before asking him to code. Use the Download button, then try again.';
  }
  return status.message ?? 'Roro\'s local brain is not ready yet. Check the startup message, then try again.';
}

export function describeBrainReadinessPending(): string {
  return 'Roro is still checking the local brain. Try again in a moment.';
}

export async function ensureBrainReady(deps: BrainReadinessDeps): Promise<boolean> {
  try {
    const status = await deps.getStatus();
    if (!status) {
      deps.onStatus?.(describeBrainReadinessPending());
      return false;
    }
    if (status.ready) return true;
    deps.onStatus?.(describeBrainReadinessBlock(status));
    return false;
  } catch (e) {
    deps.onStatus?.(`Brain readiness check failed: ${describeError(e)}`);
    return false;
  }
}

export function createBrainReadinessGate(deps: BrainReadinessGateDeps): BrainReadinessGate {
  let currentStatus: BootstrapStatusMsg | null = null;
  const apply = (status: BootstrapStatusMsg | null): void => {
    if (status === null && currentStatus !== null) return;
    currentStatus = status;
  };

  const unsubscribe = deps.subscribe(apply);
  void deps.getStatus().then(apply).catch(() => undefined);

  return {
    canStartTurn(): boolean {
      return currentStatus?.ready === true;
    },
    ensureReady(onStatus?: (text: string) => void): boolean {
      if (!currentStatus) {
        onStatus?.(describeBrainReadinessPending());
        return false;
      }
      if (currentStatus.ready) return true;
      onStatus?.(describeBrainReadinessBlock(currentStatus));
      return false;
    },
    current(): BootstrapStatusMsg | null {
      return currentStatus;
    },
    dispose(): void {
      unsubscribe();
    },
  };
}
