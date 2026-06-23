// scripts/stage-voice-assets.mjs — stage the on-device voice runtime assets into public/vad/ so they're
// served SAME-ORIGIN by the renderer (local-first, no CDN; required under COEP). Vite serves public/ at
// the root, so MicVAD's baseAssetPath/onnxWASMBasePath = '/vad/' resolves these (see sileroVad.ts).
//
// Vendored binaries — copied from node_modules at build time (gitignored), not committed. Run via the
// prestart/prepackage/premake hooks (package.json). Idempotent.

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'vad');
mkdirSync(dest, { recursive: true });

const vad = join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ort = join(root, 'node_modules', 'onnxruntime-web', 'dist');

// Silero model + the AudioWorklet processor (fetched from baseAssetPath), and the ONNX Runtime WASM
// binaries + their loaders (from onnxWASMBasePath). The .jsep.* variants back the WebGPU path.
const assets = [
  [vad, 'silero_vad_v5.onnx'],
  [vad, 'vad.worklet.bundle.min.js'],
  [ort, 'ort-wasm-simd-threaded.wasm'],
  [ort, 'ort-wasm-simd-threaded.mjs'],
  [ort, 'ort-wasm-simd-threaded.jsep.wasm'],
  [ort, 'ort-wasm-simd-threaded.jsep.mjs'],
];

let copied = 0;
for (const [src, name] of assets) {
  const from = join(src, name);
  if (!existsSync(from)) {
    console.error(`[stage-voice-assets] MISSING ${from} — is @ricky0123/vad-web / onnxruntime-web installed?`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, name));
  copied++;
}
console.log(`[stage-voice-assets] staged ${copied} asset(s) -> public/vad/`);
