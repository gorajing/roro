import type { MemoryHealthStatusMsg } from '../../shared/ipc';

export interface MemoryHealthBannerDeps {
  subscribe: (cb: (status: MemoryHealthStatusMsg | null) => void) => () => void;
  getStatus: () => Promise<MemoryHealthStatusMsg | null>;
  host?: HTMLElement;
}

const KEYCHAIN_SUMMARY = "Local memory is paused. Roro can still code; memories won't load or save until macOS Keychain is available.";
const GENERIC_SUMMARY = "Local memory is paused. Roro can still code; memories won't load or save until memory is available again.";
const DETAILS =
  "Roro's encrypted memory lives on this Mac and uses macOS Keychain to unlock it. This is not a cloud login or API key issue.";
const KEYCHAIN_DETAIL =
  'If macOS showed "Keychain Not Found" for "Roro Key", restart Roro after Keychain is available.';

function statusKey(status: MemoryHealthStatusMsg): string {
  return `${status.checkedAt}:${status.reason ?? ''}`;
}

export function mountMemoryHealthBanner(deps: MemoryHealthBannerDeps): () => void {
  const host = deps.host ?? document.getElementById('app') ?? document.body;

  const banner = document.createElement('div');
  banner.id = 'memory-health-banner';
  banner.hidden = true;

  const text = document.createElement('span');
  text.id = 'memory-health-text';
  banner.append(text);

  const details = document.createElement('button');
  details.type = 'button';
  details.id = 'memory-health-details';
  details.textContent = 'Memory details';
  banner.append(details);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.id = 'memory-health-dismiss';
  dismiss.textContent = 'Dismiss';
  banner.append(dismiss);

  host.append(banner);

  let latestKey: string | null = null;
  let dismissedKey: string | null = null;
  let detailsOpen = false;

  function summaryFor(status: MemoryHealthStatusMsg): string {
    return status.reason === 'keychain-unavailable' || status.reason === 'memory-locked'
      ? KEYCHAIN_SUMMARY
      : GENERIC_SUMMARY;
  }

  function hide(): void {
    banner.hidden = true;
    latestKey = null;
    detailsOpen = false;
  }

  function render(status: MemoryHealthStatusMsg | null): void {
    if (!status || status.state !== 'degraded') {
      dismissedKey = null;
      hide();
      return;
    }

    const key = statusKey(status);
    if (latestKey !== key) {
      latestKey = key;
      detailsOpen = false;
    }
    if (dismissedKey === key) {
      banner.hidden = true;
      return;
    }

    const parts = [summaryFor(status)];
    if (detailsOpen) {
      parts.push(DETAILS);
      if (status.reason === 'keychain-unavailable' || status.reason === 'memory-locked') parts.push(KEYCHAIN_DETAIL);
      if (status.message) parts.push(status.message);
    }
    text.textContent = parts.join(' ');
    details.hidden = detailsOpen;
    banner.hidden = false;
  }

  let current: MemoryHealthStatusMsg | null = null;
  const apply = (status: MemoryHealthStatusMsg | null): void => {
    current = status;
    render(status);
  };

  details.addEventListener('click', () => {
    detailsOpen = true;
    render(current);
  });
  dismiss.addEventListener('click', () => {
    if (current && current.state === 'degraded') dismissedKey = statusKey(current);
    banner.hidden = true;
  });

  const unsub = deps.subscribe(apply);
  void deps.getStatus().then(apply).catch(() => undefined);

  return () => { unsub(); banner.remove(); };
}
