// src/renderer/voice/onnxRuntimeEnv.ts — one place to configure the transformers.js ORT-WASM backend.
//
// Shared by EVERY on-device transformers.js consumer in the renderer (whisper STT, Kokoro TTS) so the
// load-bearing wasm/thread/model-loading config can't drift between them. Both run through the SAME
// @huggingface/transformers (ORT 1.22) instance, so its global env is configured once here.

import { env } from '@huggingface/transformers';

let configured = false;

/**
 * Configure the transformers.js ORT-WASM backend for the renderer. Idempotent (safe to call from each
 * consumer's module load). Self-hosts the wasm same-origin (public/ort/), enables threads only under
 * cross-origin isolation, runs inference in a worker (off the render thread), and uses download-and-cache
 * model loading. Resolves the wasm dir against window.location.href so it survives the packaged file:// build.
 */
export function configureOnnxRuntimeWasm(): void {
  if (configured) return;
  configured = true;

  // Self-hosted ORT 1.22 wasm (staged into public/ort/ by stage-voice-assets.mjs). A root-absolute '/ort/'
  // would point at the filesystem root under file://; resolve against the document instead.
  env.backends.onnx.wasm.wasmPaths = new URL('ort/', window.location.href).href;

  // Threads only engage under cross-origin isolation; ORT silently forces 1 thread otherwise (~2–4× slower).
  // The renderer is isolated by crossOriginIsolation.ts (COOP same-origin + COEP credentialless), so this is
  // true in dev AND the packaged file:// build. Leave a core for the render loop + audio.
  const cores = navigator.hardwareConcurrency || 4;
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, cores - 1)) : 1;

  // Run inference in a worker so a multi-hundred-ms decode/synth never blocks the PixiJS render loop.
  env.backends.onnx.wasm.proxy = true;

  // Weights download from HF then cache (Cache API); COEP credentialless permits the cross-origin no-cred
  // GET. One network event ever, then offline. (Local staging of the weights is a later packaging concern.)
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
}
