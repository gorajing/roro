// src/renderer/voice/kokoroSynthesize.ts — the REAL on-device TTS: Kokoro-82M via raw-ONNX (transformers.js).
//
// License-clean by construction: we do NOT use kokoro-js (it statically imports `phonemizer` → bundles GPLv3
// eSpeak) — we reimplement its tiny generate against @huggingface/transformers directly, with `phonemize`
// (MIT) for G2P (kokoroG2P.ts). Hardware/model-gated glue (needs the ORT-WASM backend + a model download):
// the play/lipsync/stop logic is unit-tested in kokoroVoiceEngine.test.ts against a fake Synthesize; this is
// verified by tsc (against the real lib types) + a Node smoke. Dynamically imported only when ttsVoice is on.

import { StyleTextToSpeech2Model, AutoTokenizer, Tensor } from '@huggingface/transformers';
import type { Synthesize, SynthChunk } from './kokoroVoiceEngine';
import { textToKokoroIpa } from './kokoroG2P';
import { splitSentences } from './sentenceSplit';
import { configureOnnxRuntimeWasm } from './onnxRuntimeEnv';

configureOnnxRuntimeWasm(); // shared transformers.js ORT-WASM config (public/ort/, threads, worker, download-cache)

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;
const MAX_TOKENS = 509;
// af_heart (the A-graded en-us default). Voice style matrices are STAGED SAME-ORIGIN
// (public/models/<MODEL_ID>/voices/ by stage-voice-assets.mjs), loaded by getVoiceStyle() and cached in
// memory; one per voice id (Phase 5 voice packs swap the id). Resolve against the document so it survives
// the packaged file:// build (matches onnxRuntimeEnv.ts's localModelPath).
const VOICES_BASE = new URL(`models/${MODEL_ID}/voices/`, window.location.href).href;

// transformers.js's from_pretrained/forward types for this model are loose; narrow to what we use.
type KokoroModel = (inputs: { input_ids: unknown; style: Tensor; speed: Tensor }) => Promise<{ waveform: { data: Float32Array } }>;
type KokoroTokenizer = (text: string, opts: { truncation: boolean }) => { input_ids: { dims: number[] } };

let modelP: Promise<KokoroModel> | null = null;
let tokP: Promise<KokoroTokenizer> | null = null;
const voiceCache = new Map<string, Float32Array>();

function load(): Promise<[KokoroModel, KokoroTokenizer]> {
  modelP ??= StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm' }) as unknown as Promise<KokoroModel>;
  tokP ??= AutoTokenizer.from_pretrained(MODEL_ID) as unknown as Promise<KokoroTokenizer>;
  return Promise.all([modelP, tokP]);
}

async function getVoiceStyle(voice: string): Promise<Float32Array> {
  let v = voiceCache.get(voice);
  if (!v) {
    const res = await fetch(`${VOICES_BASE}${voice}.bin`);
    if (!res.ok) throw new Error(`kokoro voice '${voice}' fetch failed: ${res.status}`);
    v = new Float32Array(await res.arrayBuffer());
    voiceCache.set(voice, v);
  }
  return v;
}

/** Synthesize ONE chunk of text → 24kHz mono PCM. */
async function synthChunk(text: string, voice: string, speed = 1): Promise<SynthChunk> {
  const [model, tokenizer] = await load();
  const { input_ids } = tokenizer(textToKokoroIpa(text), { truncation: true }); // tokenizer adds $ boundaries
  // The voice style matrix has one row per token length; pick the row for this utterance (kokoro-js's formula).
  const tokenCount = input_ids.dims.at(-1) ?? 0;
  const n = Math.min(Math.max(tokenCount - 2, 0), MAX_TOKENS);
  const styleData = await getVoiceStyle(voice);
  const off = STYLE_DIM * n;
  const style = new Tensor('float32', styleData.slice(off, off + STYLE_DIM), [1, STYLE_DIM]);
  const { waveform } = await model({ input_ids, style, speed: new Tensor('float32', [speed], [1]) });
  return { samples: waveform.data, sampleRate: SAMPLE_RATE };
}

/**
 * The injected Synthesize: stream the utterance as per-sentence chunks so the cat starts talking after
 * sentence 1 while sentence 2 synthesizes. Honors the AbortSignal (barge-in) BETWEEN chunks — a chunk
 * already mid-flight in the ONNX session can't be cancelled, but the consumer drops it.
 */
export const synthStream: Synthesize = async function* (text, { voice, signal }) {
  for (const sentence of splitSentences(text)) {
    if (signal?.aborted) return;
    yield await synthChunk(sentence, voice);
  }
};
