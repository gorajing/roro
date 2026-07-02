import { constants, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter } from 'node:path';
import type { AgentKind } from '../../shared/events';
import type { ExecutorReadinessMsg } from '../../shared/ipc';
import { resolveExecutableDetails } from '../executor/resolveBin';

interface ExecutorSpec {
  agent: AgentKind;
  name: string;
  envVar: string;
  label: string;
}

const EXECUTORS: Record<AgentKind, ExecutorSpec> = {
  codex: { agent: 'codex', name: 'codex', envVar: 'RORO_CODEX_BIN', label: 'Codex CLI' },
  claude: { agent: 'claude', name: 'claude', envVar: 'RORO_CLAUDE_BIN', label: 'Claude CLI' },
};

export interface ExecutorReadinessDeps {
  env: NodeJS.ProcessEnv;
  canExecute(path: string): Promise<boolean>;
  commonDirs?: string[];
}

async function defaultCanExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function notReadyMessage(spec: ExecutorSpec, explicitOverride: boolean): string {
  if (explicitOverride) {
    return `${spec.label} override ${spec.envVar} is not executable. Fix it or unset it.`;
  }
  return `${spec.label} not found. Install it, make sure it is on PATH, or set ${spec.envVar}.`;
}

export async function getExecutorReadiness(
  agent: AgentKind = 'codex',
  deps: ExecutorReadinessDeps = { env: process.env, canExecute: defaultCanExecute },
): Promise<ExecutorReadinessMsg> {
  const spec = EXECUTORS[agent] ?? EXECUTORS.codex;
  const commonDirs = deps.commonDirs ?? [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    ...(deps.env.HOME
      ? [
        `${deps.env.HOME}/.local/bin`,
        `${deps.env.HOME}/.bun/bin`,
        `${deps.env.HOME}/bin`,
      ]
      : []),
  ];
  const resolution = resolveExecutableDetails(spec.name, deps.env[spec.envVar], {
    exists: existsSync,
    pathDirs: (deps.env.PATH ?? '').split(delimiter).filter(Boolean),
    extraDirs: commonDirs,
  });
  const executable = resolution.found && await deps.canExecute(resolution.path);
  return {
    ready: executable,
    agent: spec.agent,
    command: spec.name,
    envVar: spec.envVar,
    path: resolution.path,
    source: resolution.source,
    message: executable ? `${spec.label} is ready.` : notReadyMessage(spec, resolution.source === 'env'),
  };
}
