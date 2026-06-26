// src/renderer/bootstrap/workdirBanner.ts — first-run working-repo picker.
//
// The executor must never guess a repo. This banner asks MAIN for the current effective workdir and,
// when unset, offers one native folder-picker action. MAIN owns the dialog + persistence.
import type { WorkdirConfigMsg } from '../../shared/ipc';
import { WORKDIR_CONFIGURED_EVENT } from './workdirSetup';

export interface WorkdirBannerDeps {
  getConfig: () => Promise<WorkdirConfigMsg>;
  chooseWorkdir: () => Promise<WorkdirConfigMsg>;
  onStatus?: (text: string) => void;
  host?: HTMLElement;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function mountWorkdirBanner(deps: WorkdirBannerDeps): () => void {
  const host = deps.host ?? document.getElementById('app') ?? document.body;

  const banner = document.createElement('div');
  banner.id = 'workdir-banner';
  banner.hidden = true;
  const text = document.createElement('span');
  text.id = 'workdir-text';
  text.setAttribute('role', 'status');
  text.setAttribute('aria-live', 'polite');
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.id = 'workdir-choose';
  choose.textContent = 'Choose Project';
  choose.setAttribute('aria-describedby', text.id);
  banner.append(text, choose);
  host.append(banner);

  function show(message: string): void {
    text.textContent = message;
    banner.hidden = false;
  }

  function apply(config: WorkdirConfigMsg): void {
    if (config.workdir) {
      banner.hidden = true;
      return;
    }
    choose.disabled = false;
    show('Choose a project for Roro to work on.');
  }

  void deps.getConfig().then(apply).catch((e) => {
    choose.disabled = false;
    show(`Project setup unavailable: ${describeError(e)}`);
  });

  const configuredListener = (event: Event): void => {
    const config = (event as CustomEvent<WorkdirConfigMsg>).detail;
    if (config) apply(config);
  };
  window.addEventListener(WORKDIR_CONFIGURED_EVENT, configuredListener);

  choose.addEventListener('click', () => {
    choose.disabled = true;
    show('Opening project picker…');
    void deps.chooseWorkdir()
      .then((config) => {
        if (config.workdir) {
          banner.hidden = true;
          deps.onStatus?.('Project selected — Roro can run coding tasks.');
          return;
        }
        apply(config);
      })
      .catch((e) => {
        choose.disabled = false;
        show(`Project setup failed: ${describeError(e)}`);
      });
  });

  return () => {
    window.removeEventListener(WORKDIR_CONFIGURED_EVENT, configuredListener);
    banner.remove();
  };
}
