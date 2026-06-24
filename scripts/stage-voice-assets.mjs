// scripts/stage-voice-assets.mjs — stage the on-device voice runtime assets into public/ so they're served
// SAME-ORIGIN by the renderer (local-first, no CDN; required under COEP). Each consumer resolves its dir
// against window.location.href (e.g. new URL('vad/', …) / new URL('ort/', …)) so it works in dev AND the
// packaged file:// build (see sileroVad.ts / whisperTranscribe.ts).
//
// TWO DISTINCT ORT BUILDS — DO NOT MERGE THEM:
//   public/vad/ — Silero VAD via @ricky0123/vad-web, which bundles onnxruntime-web 1.27.
//   public/ort/ — whisper via @huggingface/transformers 3.x, which bundles onnxruntime-web 1.22.
// The two ORT wasm builds are non-interchangeable; a 1.27 wasm loaded by the 1.22 .mjs factory (or vice
// versa) fails with "expected magic word 00 61 73 6d". Hence separate dirs + separate sources.
//
// Vendored binaries — copied from node_modules at build time (gitignored), not committed. Run via the
// prestart/prepackage/premake hooks (package.json). Idempotent.

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const vadSrc = join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortSrc = join(root, 'node_modules', 'onnxruntime-web', 'dist'); // the 1.27 build vad-web uses
const whisperSrc = join(root, 'node_modules', '@huggingface', 'transformers', 'dist'); // bundles its own 1.22 ORT wasm

// [sourceDir, filename, destSubdir]. Silero model + AudioWorklet (baseAssetPath) + ORT 1.27 wasm/loaders
// (onnxWASMBasePath) -> public/vad/; transformers.js's OWN ORT 1.22 wasm (jsep variant) -> public/ort/.
const assets = [
  [vadSrc, 'silero_vad_v5.onnx', 'vad'],
  [vadSrc, 'vad.worklet.bundle.min.js', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.wasm', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.mjs', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.jsep.wasm', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.jsep.mjs', 'vad'],
  [whisperSrc, 'ort-wasm-simd-threaded.jsep.wasm', 'ort'],
  [whisperSrc, 'ort-wasm-simd-threaded.jsep.mjs', 'ort'],
];

const counts = {};
for (const [src, name, sub] of assets) {
  const from = join(src, name);
  if (!existsSync(from)) {
    console.error(`[stage-voice-assets] MISSING ${from} — are @ricky0123/vad-web, onnxruntime-web and @huggingface/transformers installed?`);
    process.exit(1);
  }
  const destDir = join(root, 'public', sub);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(from, join(destDir, name));
  counts[sub] = (counts[sub] ?? 0) + 1;
}
console.log(
  `[stage-voice-assets] staged ${Object.entries(counts).map(([d, n]) => `${n} -> public/${d}/`).join(', ')}`,
);
