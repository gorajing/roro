// src/renderer/settings/projectSettings.ts - small Settings surface for the chosen working repo.
//
// The native folder picker + persistence already live in MAIN (`config:chooseWorkdir`). This renderer
// surface is only a repeatable way to invoke that same choice after first-run onboarding.
import type { WorkdirConfigMsg } from '../../shared/ipc';
import { notifyWorkdirConfigured, WORKDIR_CONFIGURED_EVENT } from '../bootstrap/workdirSetup';

export interface ProjectSettingsDeps {
  getConfig: () => Promise<WorkdirConfigMsg>;
  chooseWorkdir: () => Promise<WorkdirConfigMsg>;
  onStatus?: (text: string) => void;
  isRunActive?: () => boolean;
  host?: HTMLElement;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sourceLabel(source: WorkdirConfigMsg['source']): string {
  if (source === 'env') return 'RORO_WORKDIR';
  if (source === 'config') return 'Saved project';
  return 'No project selected';
}

function basenameFromPath(path: string): string {
  const parts = path.trim().split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function toggleLabel(config: WorkdirConfigMsg): string {
  if (!config.workdir) return 'Project: Choose...';
  const name = basenameFromPath(config.workdir);
  return config.source === 'env' ? `Project: ${name} (env)` : `Project: ${name}`;
}

function toggleAriaLabel(config: WorkdirConfigMsg): string {
  if (!config.workdir) return 'No project selected. Choose project.';
  const source = config.source === 'env' ? ' Set by RORO_WORKDIR.' : '';
  return `Current project: ${config.workdir}.${source} Change project.`;
}

export function mountProjectSettings(deps: ProjectSettingsDeps): () => void {
  const host = deps.host ?? document.getElementById('controls') ?? document.getElementById('app') ?? document.body;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'project-settings-toggle';
  toggle.textContent = 'Project: Choose...';
  toggle.setAttribute('aria-label', 'No project selected. Choose project.');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'project-settings-panel');

  const panel = document.createElement('div');
  panel.id = 'project-settings-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Roro settings');

  const heading = document.createElement('h2');
  heading.textContent = 'Settings';

  const row = document.createElement('div');
  row.className = 'project-settings-row';

  const label = document.createElement('span');
  label.className = 'project-settings-label';
  label.textContent = 'Project';

  const current = document.createElement('span');
  current.id = 'project-settings-current';
  current.setAttribute('role', 'status');
  current.setAttribute('aria-live', 'polite');

  const source = document.createElement('span');
  source.id = 'project-settings-source';

  const change = document.createElement('button');
  change.type = 'button';
  change.id = 'project-settings-change';
  change.textContent = 'Change Project';
  change.setAttribute('aria-describedby', 'project-settings-current');

  row.append(label, current, source);
  panel.append(heading, row, change);
  host.append(toggle, panel);

  let lastConfig: WorkdirConfigMsg = { source: 'unset' };

  function apply(config: WorkdirConfigMsg): void {
    lastConfig = config;
    current.textContent = config.workdir ?? 'No project selected';
    source.textContent = sourceLabel(config.source);
    change.textContent = config.workdir ? 'Change Project' : 'Choose Project';
    change.setAttribute('aria-disabled', String(config.source === 'env'));
    change.disabled = false;
    toggle.textContent = toggleLabel(config);
    toggle.setAttribute('aria-label', toggleAriaLabel(config));
  }

  function showError(message: string): void {
    current.textContent = message;
    source.textContent = 'Settings unavailable';
    change.disabled = false;
    change.setAttribute('aria-disabled', 'false');
    toggle.textContent = 'Project: unavailable';
    toggle.setAttribute('aria-label', message);
  }

  function refresh(): void {
    void deps.getConfig()
      .then(apply)
      .catch((e) => showError(`Project settings failed: ${describeError(e)}`));
  }

  const configuredListener = (event: Event): void => {
    const config = (event as CustomEvent<WorkdirConfigMsg>).detail;
    if (config) apply(config);
  };
  window.addEventListener(WORKDIR_CONFIGURED_EVENT, configuredListener);
  refresh();

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) refresh();
  });

  change.addEventListener('click', () => {
    if (deps.isRunActive?.()) {
      deps.onStatus?.('Wait for the current run to finish before changing projects.');
      return;
    }
    if (lastConfig.source === 'env') {
      deps.onStatus?.('This launch uses RORO_WORKDIR. Unset it to use a saved project.');
      return;
    }
    change.disabled = true;
    current.textContent = 'Opening project picker...';
    void deps.chooseWorkdir()
      .then((config) => {
        apply(config);
        if (!config.workdir) {
          deps.onStatus?.('Project unchanged.');
          return;
        }
        notifyWorkdirConfigured(config);
        deps.onStatus?.(`Project changed to ${basenameFromPath(config.workdir)}. New tasks will use it.`);
      })
      .catch((e) => {
        change.disabled = false;
        showError(`Project change failed: ${describeError(e)}`);
      });
  });

  return () => {
    window.removeEventListener(WORKDIR_CONFIGURED_EVENT, configuredListener);
    toggle.remove();
    panel.remove();
  };
}
