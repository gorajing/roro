// src/main/crossOriginIsolation.ts — cross-origin isolation headers for the renderer (the voice WASM floor).
//
// SharedArrayBuffer + multi-threaded WASM (what makes whisper/Silero/Kokoro ~3x via threaded SIMD instead
// of single-threaded) require the renderer to be cross-origin ISOLATED: COOP same-origin + COEP. We use
// COEP `credentialless` (NOT `require-corp`): credentialless still enables isolation, but lets cross-origin
// model downloads (the HF CDN, fetched without credentials) load WITHOUT a per-resource CORP header —
// require-corp would block them, breaking the first-run model pull. Same-origin app assets are unaffected.

type Headers = Record<string, string[]>;

export const CROSS_ORIGIN_ISOLATION_HEADERS: Headers = {
  'Cross-Origin-Opener-Policy': ['same-origin'],
  'Cross-Origin-Embedder-Policy': ['credentialless'],
};

/** Merge the isolation headers into a webRequest responseHeaders map, replacing any existing COOP/COEP
 *  (header names are case-insensitive, so strip prior variants before adding ours). */
export function withCrossOriginIsolation(responseHeaders: Headers | undefined): Headers {
  const merged: Headers = {};
  for (const [key, value] of Object.entries(responseHeaders ?? {})) {
    const lk = key.toLowerCase();
    if (lk === 'cross-origin-opener-policy' || lk === 'cross-origin-embedder-policy') continue; // ours win
    merged[key] = value;
  }
  return { ...merged, ...CROSS_ORIGIN_ISOLATION_HEADERS };
}
