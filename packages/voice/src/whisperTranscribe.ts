// packages/voice/src/whisperTranscribe.ts — the REAL on-device STT: whisper base.en via transformers.js.
//
// Hardware/model-gated glue (needs the WASM backend + a ~77MB model download): the engine LOGIC — the
// commit/partial split, the mute gate, the transcription race, the empty/failed-transcript guards — is
// unit-tested against a FAKE transcribe in vadVoiceEngine.test.ts. This module is verified by construction
// against the transformers.js v3 API + exercised live on a mic-equipped session (see PR notes), mirroring
// how sileroVad.ts is the untested-but-real VAD source behind the same kind of injected seam.
//
// It is DYNAMICALLY imported by bootstrap ONLY when config.sttVoice is on, so transformers.js + its ORT
// WASM never load for non-voice users.

import {
  pipeline,
  TextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import type { Transcribe } from './vadVoiceEngine';
import { isNonSpeechAnnotation } from './nonSpeechFilter';
import { configureOnnxRuntimeWasm } from './onnxRuntimeEnv';

// Configure the shared transformers.js ORT-WASM backend (self-hosted public/ort/ wasm, threads under
// cross-origin isolation, worker, download-and-cache). Same config Kokoro TTS uses — see onnxRuntimeEnv.ts.
configureOnnxRuntimeWasm();

// base.en is the tested floor (threaded-SIMD WASM). The small.en WebGPU upgrade is a later, explicitly-gated path.
const MODEL_ID = 'onnx-community/whisper-base.en';

// transformers.js's pipeline() is overloaded across EVERY task, and tsc can't represent the inferred return
// union for our specific call (TS2590: "union type too complex"). Narrow it to the one task we use — this
// both fixes the compile and documents the option values we rely on. Runtime behavior is unchanged.
type BuildAsr = (
  task: 'automatic-speech-recognition',
  model: string,
  options: {
    dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | 'int8' | 'uint8';
    device?: 'wasm' | 'webgpu' | 'cpu';
    progress_callback?: (p: ProgressInfo) => void;
  },
) => Promise<AutomaticSpeechRecognitionPipeline>;
const buildAsr = pipeline as unknown as BuildAsr;

let pipePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
/** Build (download + compile) the ASR pipeline ONCE; memoized so warm + every transcribe share one load. */
function loadPipe(onProgress?: (p: ProgressInfo) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  return (pipePromise ??= buildAsr('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8', // the *_quantized files — smallest/fastest on CPU WASM
    device: 'wasm',
    progress_callback: onProgress,
  }));
}

/**
 * Construct the per-utterance Transcribe. Returns SYNCHRONOUSLY (no await) so the engine — and the VAD
 * ear-perk — come alive immediately: the cat's ears must perk at ≤80ms regardless of whether the 77MB model
 * has finished loading. The model warms in the BACKGROUND here and each transcribe() awaits the same memoized
 * load; the first utterance pays any remaining load, every later one is fast.
 */
export function createWhisperTranscribe(onProgress?: (p: ProgressInfo) => void): Transcribe {
  // Kick the load now (non-blocking). Guard the fire-and-forget so a pre-utterance load failure doesn't
  // surface as an unhandled rejection — a real load failure is still surfaced per-utterance, because
  // transcribe() awaits this same promise and the engine's try/catch warns + drops that utterance.
  void loadPipe(onProgress).catch(() => undefined);

  return async (audio, opts) => {
    const asr = await loadPipe();

    // TextStreamer.callback_function emits a DELTA (text.slice(print_len)), not the cumulative string. The
    // engine forwards opts.onPartial straight to onPartialTranscript WITHOUT accumulating, so accumulate
    // the running hypothesis HERE and emit it cumulative — else the caption shows only the latest fragment.
    let running = '';
    const streamer = opts?.onPartial
      ? new TextStreamer(asr.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (delta: string) => {
            running += delta;
            opts.onPartial?.(running);
          },
        })
      : undefined;

    // The Float32Array is passed straight in — transformers.js does NOT resample a raw typed array, so the
    // 16kHz-mono invariant lives at OUR seam (Silero's onSpeechEnd already gives 16kHz mono in [-1,1]). One
    // VAD utterance is well under 30s, so chunk_length_s stays at its default 0 (one decode pass; partials
    // stream token-by-token). Do NOT pair a streamer with return_timestamps (mutually exclusive).
    //
    // CRITICAL: base.en is an ENGLISH-ONLY model — passing `language` or `task` THROWS at decode time
    // ("Cannot specify task or language for an English-only model"), which would drop EVERY utterance.
    // Omit them. (A future multilingual model would set them; an `.en` model must not.)
    const out = await asr(audio, streamer ? { streamer } : {});

    const final = (Array.isArray(out) ? out[0].text : out.text).trim(); // Whisper prepends a leading space
    // A pure non-speech annotation ("[Music]", "[BLANK_AUDIO]") from a VAD false-positive is not a command —
    // return '' so the engine's empty-guard drops it instead of routing it to the brain (mouth-not-brain).
    return isNonSpeechAnnotation(final) ? '' : final;
  };
}
