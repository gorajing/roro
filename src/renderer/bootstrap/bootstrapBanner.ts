// src/renderer/bootstrap/bootstrapBanner.ts — the first-run one-click model download (M7b UI).
//
// MAIN pushes a BootstrapStatusMsg when the local brain isn't ready; this banner turns it into action: if
// Ollama is down it shows an install hint; if Ollama is up but the core models are missing it offers a
// "Download (~2GB)" button that streams the pull progress. A thin DOM shell over injected deps (the status
// subscription + a pull() that streams ModelPullProgressMsg) — both jsdom-tested; the real pull is verified
// against a live daemon on a device. Fails loud: a pull error is shown + the button re-enabled to retry.

import type { BootstrapStatusMsg, ModelPullProgressMsg } from '../../shared/ipc';

export interface BootstrapBannerDeps {
  /** Subscribe to MAIN's readiness pushes (null = no status yet). Returns an unsubscribe. */
  subscribe: (cb: (status: BootstrapStatusMsg | null) => void) => () => void;
  /** Fetch the CURRENT readiness on demand — recovers a push that fired before we subscribed (the startup
   *  race: MAIN sends on did-finish-load, but the renderer subscribes after the async character load). */
  getStatus: () => Promise<BootstrapStatusMsg | null>;
  /** Pull the given models, streaming progress. Resolves when all are done; rejects on failure. */
  pull: (models: string[], onProgress: (p: ModelPullProgressMsg) => void) => Promise<void>;
  host?: HTMLElement;
}

function fmtBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export function mountBootstrapBanner(deps: BootstrapBannerDeps): () => void {
  const host = deps.host ?? document.getElementById('app') ?? document.body;

  const banner = document.createElement('div');
  banner.id = 'bootstrap-banner';
  banner.hidden = true;
  const text = document.createElement('span');
  text.id = 'bootstrap-text';
  banner.append(text);
  host.append(banner);

  let pulling = false;

  function show(msg: string): void {
    text.textContent = msg;
    banner.hidden = false;
  }
  function clearButton(): void {
    banner.querySelector('#bootstrap-download')?.remove();
  }

  function renderMissing(status: BootstrapStatusMsg): void {
    show(`Roro needs its core models (~${fmtBytes(status.essentialBytes)}) to think on-device.`);
    if (banner.querySelector('#bootstrap-download')) return; // already offered
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'bootstrap-download';
    btn.textContent = `Download (~${fmtBytes(status.essentialBytes)})`;
    btn.addEventListener('click', () => {
      if (pulling) return;
      pulling = true;
      btn.disabled = true;
      show('Starting download…');
      void deps
        .pull(
          status.missing.map((m) => m.name),
          (p) => {
            if (p.error) { show(`Download failed: ${p.error} — retry?`); btn.disabled = false; pulling = false; return; }
            if (p.done) { show('Models ready — Roro can think on-device now.'); btn.remove(); pulling = false; return; }
            show(`Downloading ${p.model}${typeof p.percent === 'number' ? ` — ${p.percent}%` : '…'}`);
          },
        )
        .catch((e) => {
          // Fail loud, not silent: surface the error + re-enable the button to retry.
          show(`Download failed: ${e instanceof Error ? e.message : String(e)} — retry?`);
          btn.disabled = false;
          pulling = false;
        });
    });
    banner.append(btn);
  }

  function apply(status: BootstrapStatusMsg | null): void {
    if (pulling) return; // don't clobber an in-flight download with a re-pushed/re-fetched status
    if (!status || status.ready) { banner.hidden = true; clearButton(); return; }
    if (status.needsOllamaInstall) {
      clearButton();
      show("Ollama isn't running. Install it from ollama.com, then Roro can pull its models.");
      return;
    }
    if (status.missing.length > 0) { renderMissing(status); return; }
    banner.hidden = true;
  }

  const unsub = deps.subscribe(apply);
  // Recover a status pushed before this subscription existed (the startup race) — fetch the current one once.
  void deps.getStatus().then(apply).catch(() => undefined);

  return () => { unsub(); banner.remove(); };
}
