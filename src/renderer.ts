// src/renderer.ts — renderer entry, loaded by Vite as the module bundle.
//
// All real work lives in src/renderer/** modules; this file just boots them once
// the DOM is ready.

import './index.css';
import { bootstrap } from './renderer/bootstrap';

function start(): void {
  bootstrap().catch((err) => {
    console.error('[renderer] bootstrap failed', err);
    const s = document.getElementById('status');
    if (s) s.textContent = `Renderer failed to start: ${err instanceof Error ? err.message : String(err)}`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
