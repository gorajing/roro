// src/renderer/voice/sileroVad.ts — the REAL VAD source: Silero (v5) via @ricky0123/vad-web.
//
// Hardware-gated glue (needs a mic + the Silero WASM/worklet); the engine LOGIC + lifecycle are unit-
// tested against a fake in vadVoiceEngine.test.ts. Dynamically imported by bootstrap ONLY when the local
// VAD path is enabled, so the onnxruntime-web/Silero WASM never loads for non-voice users.
//
// echoCancellation/noiseSuppression on the captured stream is the day-one non-negotiable: the cat must
// not barge-in on its own TTS. startOnLoad:false → we own start()/destroy() (summon gating, near-zero-idle).

import { MicVAD } from '@ricky0123/vad-web';
import type { CreateVad, VadSource } from './vadVoiceEngine';

export const createSileroVad: CreateVad = async (callbacks): Promise<VadSource> => {
  // Resolve the staged-asset dir against the document URL so it works BOTH on the Vite dev server
  // (http://localhost/.../vad/) AND in a packaged file:// build (.../renderer/main_window/vad/) — a
  // root-absolute '/vad/' would point at the filesystem root under file://.
  const assetBase = new URL('vad/', window.location.href).href;
  const vad = await MicVAD.new({
    model: 'v5',
    startOnLoad: false,
    // Local-first: the Silero model + worklet + ONNX-Runtime WASM are staged SAME-ORIGIN into public/vad/
    // (scripts/stage-voice-assets.mjs) — never a CDN. baseAssetPath fetches silero_vad_v5.onnx +
    // vad.worklet.bundle.min.js; onnxWASMBasePath points ORT at the ort-wasm-* binaries.
    baseAssetPath: assetBase,
    onnxWASMBasePath: assetBase,
    onSpeechStart: () => callbacks.onSpeechStart(),
    onSpeechEnd: (_audio: Float32Array) => callbacks.onSpeechEnd(), // Phase 2: hand _audio to whisper STT
    getStream: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
  });
  return {
    start: () => vad.start(),
    destroy: () => vad.destroy(),
  };
};
