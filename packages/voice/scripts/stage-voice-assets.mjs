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

import { mkdirSync, copyFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const realVadEnabled =
  process.env.RORO_VAD_VOICE === '1' ||
  process.env.RORO_STT_VOICE === '1' ||
  process.env.RORO_TTS_VOICE === '1';
const transformerVoiceEnabled =
  process.env.RORO_STT_VOICE === '1' ||
  process.env.RORO_TTS_VOICE === '1';

const vadSrc = join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortSrc = join(root, 'node_modules', 'onnxruntime-web', 'dist'); // the 1.27 build vad-web uses
const whisperSrc = join(root, 'node_modules', '@huggingface', 'transformers', 'dist'); // bundles its own 1.22 ORT wasm

// [sourceDir, filename, destSubdir]. Silero model + AudioWorklet (baseAssetPath) + ORT 1.27 wasm/loaders
// (onnxWASMBasePath) -> public/vad/; transformers.js's OWN ORT 1.22 wasm (jsep variant) -> public/ort/.
const vadAssets = [
  [vadSrc, 'silero_vad_v5.onnx', 'vad'],
  [vadSrc, 'vad.worklet.bundle.min.js', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.wasm', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.mjs', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.jsep.wasm', 'vad'],
  [ortSrc, 'ort-wasm-simd-threaded.jsep.mjs', 'vad'],
];
const transformerOrtAssets = [
  [whisperSrc, 'ort-wasm-simd-threaded.jsep.wasm', 'ort'],
  [whisperSrc, 'ort-wasm-simd-threaded.jsep.mjs', 'ort'],
];

const counts = {};
const assets = [
  ...(realVadEnabled ? vadAssets : []),
  ...(transformerVoiceEnabled ? transformerOrtAssets : []),
];
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
if (assets.length === 0) {
  console.log('[stage-voice-assets] no real voice flags set — skipping VAD/ORT runtime staging.');
} else {
  console.log(
    `[stage-voice-assets] staged ${Object.entries(counts).map(([d, n]) => `${n} -> public/${d}/`).join(', ')}`,
  );
}

// ─── On-device MODEL WEIGHTS (whisper STT + Kokoro TTS) ────────────────────────────────────────────────
// Unlike the wasm runtimes above (vendored in node_modules), the model weights are DOWNLOADED from Hugging
// Face — there is no npm package for them. They are large (~175MB total), so the download is FLAG-GATED:
// a plain `npm start` pays nothing; `RORO_STT_VOICE=1` stages whisper, `RORO_TTS_VOICE=1` stages Kokoro.
// Staged same-origin into public/models/{repo}/… (gitignored, regenerable) so the renderer loads them with
// env.allowLocalModels=true / env.localModelPath='models/' (onnxRuntimeEnv.ts) and CSP connect-src 'self'.
//
// Keep the dtype + ids in sync with whisperTranscribe.ts (MODEL_ID, dtype:'q8'), kokoroSynthesize.ts
// (MODEL_ID, dtype:'q8'), and voicePacks.ts (VOICE_PACKS ids). dtype 'q8' → the *_quantized ONNX files.
// `rev` PINS an immutable commit sha (not the mutable 'main' ref) so the staged bytes are reproducible and
// can't shift under us between runs; bump it deliberately to adopt a new upstream revision.
const HF = 'https://huggingface.co';
const models = [
  {
    repo: 'onnx-community/whisper-base.en',
    rev: '51eefc0af78b103839eda9e7e4f4186acc6517fe',
    enabled: process.env.RORO_STT_VOICE === '1',
    keepOnnx: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
    keepVoices: [],
  },
  {
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    rev: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    enabled: process.env.RORO_TTS_VOICE === '1',
    keepOnnx: ['onnx/model_quantized.onnx'],
    // The curated VOICE_PACKS catalog (voicePacks.ts) — 5 voices, not all 55.
    keepVoices: ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george'].map((v) => `voices/${v}.bin`),
  },
];

function die(msg) {
  console.error(`[stage-voice-assets] ${msg}`);
  process.exit(1);
}

// Bounded fetch so a hung/stalled HF connection FAILS LOUD (the idempotent re-run then self-heals) instead
// of hanging `npm start` forever. 120s is generous even for a ~90MB LFS blob on a slow link.
async function fetchOrDie(url, what) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    die(`fetch stalled/failed for ${what}: ${e?.name ?? ''} ${e?.message ?? e}`.trim());
  }
}

async function stageModel({ repo, rev, keepOnnx, keepVoices }) {
  const treeRes = await fetchOrDie(`${HF}/api/models/${repo}/tree/${rev}?recursive=true`, `${repo} tree`);
  if (!treeRes.ok) die(`HF tree fetch failed for ${repo}@${rev}: ${treeRes.status} ${treeRes.statusText}`);
  const tree = await treeRes.json();
  // Stage EVERY small config/tokenizer file (cheap; avoids guessing which JSON transformers.js reads) but
  // only the dtype:'q8' ONNX weights and the curated voice matrices. Skip repo cruft.
  const keep = tree.filter((x) => x.type === 'file').filter((f) => {
    if (f.path === '.gitattributes' || f.path === 'README.md') return false;
    if (f.path.startsWith('onnx/')) return keepOnnx.includes(f.path);
    if (f.path.startsWith('voices/')) return keepVoices.includes(f.path);
    return true;
  });
  const repoRoot = join(root, 'public', 'models', repo);
  let staged = 0, skipped = 0, bytes = 0;
  for (const f of keep) {
    const expected = f.lfs?.size ?? f.size; // LFS files report their real size under .lfs
    const dest = join(repoRoot, f.path);
    // CONTAINMENT: f.path is untrusted (third-party HF tree JSON). Every staged file must land UNDER this
    // model's own public/models/<repo>/ dir — a '../', absolute, or normalized-escape form must fail loud,
    // never write out of tree (a compromised/MITM'd HF response otherwise gets an arbitrary-write primitive).
    const rel = relative(repoRoot, dest);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) die(`refusing unsafe staging path ${repo}/${f.path}`);
    if (existsSync(dest) && expected != null && statSync(dest).size === expected) { skipped++; continue; }
    mkdirSync(dirname(dest), { recursive: true });
    const r = await fetchOrDie(`${HF}/${repo}/resolve/${rev}/${f.path}`, `${repo}/${f.path}`);
    if (!r.ok) die(`download failed ${repo}/${f.path}: ${r.status} ${r.statusText}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (expected != null && buf.length !== expected) die(`size mismatch ${repo}/${f.path}: got ${buf.length}, expected ${expected}`);
    writeFileSync(dest, buf);
    staged++; bytes += buf.length;
  }
  console.log(`[stage-voice-assets] ${repo}: staged ${staged}, skipped ${skipped} (${(bytes / 1e6).toFixed(1)}MB) -> public/models/${repo}/`);
}

const wanted = models.filter((m) => m.enabled);
if (wanted.length === 0) {
  console.log('[stage-voice-assets] no voice model flags set (RORO_STT_VOICE / RORO_TTS_VOICE) — skipping the ~175MB model download.');
} else {
  for (const m of wanted) await stageModel(m); // serial: avoid hammering HF with parallel large GETs
}
