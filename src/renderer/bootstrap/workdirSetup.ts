import type { WorkdirConfigMsg } from '../../shared/ipc';

export interface WorkdirSetupDeps {
  getConfig: () => Promise<WorkdirConfigMsg>;
  chooseWorkdir: () => Promise<WorkdirConfigMsg>;
  onStatus?: (text: string) => void;
  onConfigured?: (config: WorkdirConfigMsg) => void;
}

export const WORKDIR_CONFIGURED_EVENT = 'roro:workdir-configured';

export function notifyWorkdirConfigured(config: WorkdirConfigMsg): void {
  window.dispatchEvent(new CustomEvent(WORKDIR_CONFIGURED_EVENT, { detail: config }));
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function ensureWorkdirReady(deps: WorkdirSetupDeps): Promise<boolean> {
  try {
    const current = await deps.getConfig();
    if (current.workdir) {
      deps.onConfigured?.(current);
      return true;
    }

    deps.onStatus?.('Choose a project before running a coding task.');
    const chosen = await deps.chooseWorkdir();
    if (chosen.workdir) {
      deps.onStatus?.('Project selected — Roro can run coding tasks.');
      deps.onConfigured?.(chosen);
      return true;
    }

    deps.onStatus?.('Choose a project before running a coding task.');
    return false;
  } catch (e) {
    deps.onStatus?.(`Project setup failed: ${describeError(e)}`);
    return false;
  }
}
