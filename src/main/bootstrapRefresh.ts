import { ollamaTags } from '../brain/ollama';
import type { BootstrapStatusMsg } from '../shared/ipc';
import { bootstrapFailureMessage, bootstrapStatusFor, type OllamaProbe } from './bootstrapPlan';
import { setBootstrapStatus } from './bootstrapStatusStore';
import { loadBrain, type BrainModule, type BrainPreflightResult } from './siblings';

export interface BootstrapRefreshResult {
  ok: boolean;
  status: BootstrapStatusMsg;
  message: string;
  brainDescription?: string;
  required?: BrainPreflightResult['required'];
}

export interface BootstrapRefreshDeps {
  env?: NodeJS.ProcessEnv;
  loadBrain?: () => Promise<Pick<BrainModule, 'preflight' | 'describeBrain'>>;
  ollamaTags?: () => Promise<string[]>;
}

export function notReadyStatus(message: string, status: BootstrapStatusMsg | null = null): BootstrapStatusMsg {
  return {
    needsOllamaInstall: false,
    missing: [],
    essentialBytes: 0,
    ...status,
    ready: false,
    message,
  };
}

function probeKindFromError(err: unknown): OllamaProbe {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /timed out/i.test(message) ? { kind: 'degraded' } : { kind: 'unreachable' };
}

export async function refreshBootstrapStatus(
  deps: BootstrapRefreshDeps = {},
): Promise<BootstrapRefreshResult> {
  const load = deps.loadBrain ?? loadBrain;
  const tags = deps.ollamaTags ?? ollamaTags;
  const env = deps.env ?? process.env;

  try {
    const brain = await load();
    const result = await brain.preflight();
    const status: BootstrapStatusMsg = {
      ready: true,
      needsOllamaInstall: false,
      missing: [],
      essentialBytes: 0,
    };
    setBootstrapStatus(status);
    return {
      ok: true,
      status,
      message: 'Local brain ready.',
      brainDescription: brain.describeBrain(),
      required: result.required,
    };
  } catch (err) {
    const baseMessage = `Local brain unavailable: ${(err as Error).message}`;
    let message = baseMessage;
    let status: BootstrapStatusMsg | null = null;

    if (env.BRAIN_PROVIDER !== 'nebius') {
      let probe: OllamaProbe;
      try {
        probe = { kind: 'reachable', models: await tags() };
      } catch (probeErr) {
        probe = probeKindFromError(probeErr);
      }
      message = bootstrapFailureMessage(baseMessage, 'ollama', probe);
      status = bootstrapStatusFor(probe);
    }

    const finalStatus = notReadyStatus(message, status);
    setBootstrapStatus(finalStatus);
    return { ok: false, status: finalStatus, message };
  }
}
