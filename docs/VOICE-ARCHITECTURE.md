# Roro On-Device Voice — Architecture & Build Plan (plan of record)

> The on-device voice adapter replaces the Vapi cloud facade with a local pipeline. The **seam, FSM,
> turn-router, mic IPC, and lipsync are already built + tested** (`src/renderer/voice/*`, Phase D / WS3);
> this plan adds the real engine + the two missing glue pieces, behind the existing `available` gate.
> Where this conflicts with older docs, this wins.

## Locked invariants (unchanged by voice)

- **The `ActionEvent` union stays FROZEN.** Voice adds no event kinds. Ears = the renderer callback
  `onSpeechStart`; the mouth = the existing `message`/`message.delta` events routed into `speak()`.
- **The orchestrator is untouched.** `turnRun(transcript)` is the single ingress; only a *committed*
  `onFinalTranscript` reaches it (mouth-not-brain). A voice turn === a typed turn (same recall/remember).
- **near-zero-idle**: voice is SUMMONED, never always-on (`start()`/`stop()` gated behind Voice Mode).
- **Provider-seam law**: the engine is injected behind `NativeVoiceEngine`
  (`start/stop/speak/setMuted`); `createLocalVoiceBackend` wraps it with a fail-loud `available` gate.
- **Monetization = cosmetics**: Kokoro's multiple voices are the basis for **voice packs**.

## Engines + the packaging decision (empirically validated)

- **STT** = whisper (ONNX), **VAD** = Silero, **TTS** = Kokoro — all on-device, $0.
- **Packaging: renderer-side WASM/ONNX-web (Path A).** Zero native binaries (matches the PGlite-WASM
  precedent — no `electron-rebuild`/per-arch builds/notarization), a single renderer WebAudio graph for
  tight lipsync + barge-in. The `NativeVoiceEngine` seam keeps a native-addon escalation reversible —
  **only STT**, gated on profiling — if ever needed. Native-in-main + daemon paths were rejected.

### Spike results (Apple M5, q8 ONNX, threaded SIMD WASM; `scratchpad/voicespike`)

| Component | native (onnxruntime-node) | **WASM (onnxruntime-web)** | size (q8) |
|---|---|---|---|
| STT base.en — 3s cmd | ~0.28s | **~0.8s** (M5) → ~2.4s worst-case no-GPU | 77MB |
| STT small.en — 3s cmd | ~0.72s | ~2.2s → ~6.6s worst-case no-GPU | 249MB |
| TTS Kokoro — ~2s sentence | RTF 0.39 | **RTF 0.73** (M5) → ~2.2 worst-case | 92MB |
| WASM penalty | — | STT ~3.0× · TTS ~1.8× | — |

WASM is only ~3× native (threaded SIMD is efficient); the Electron renderer's WebGPU recovers toward
native. Conclusion: **Path A is viable.**

### Decisions the data forced

1. **base.en is the DEFAULT** (not small.en) — base.en commits a short command in ~0.8s (M5) / ~2.4s
   worst-case, acceptable under the turn-taking-pause UX (ear-perk + live partials carry responsiveness).
   **small.en is a WebGPU-gated opt-in "sharper dictation" upgrade** (too slow on no-GPU WASM).
2. **TTS streams** sentence-by-sentence (playback starts on the first chunk) — Kokoro WASM is real-time
   on a decent CPU/WebGPU but slower-than-playback on a weak no-GPU CPU.
3. **Kokoro ONNX + a non-GPL G2P (NOT `kokoro-js`)** — `kokoro-js`→`phonemizer` bundles eSpeak NG
   (GPLv3), incompatible with a monetized bundle. CI must assert eSpeak's absence.
4. **Prefer WebGPU**, with the threaded-WASM-CPU path as the supported floor.
5. **Day-one**: COOP `same-origin` + COEP `require-corp` headers (so WASM threads are on — that's the
   3× vs 6× difference) + `getUserMedia({audio:{echoCancellation:true}})` (so the cat can't barge-in on
   its own TTS).

## Phased build (each behind `available`/a flag; 🧪 CI-testable / 🎧 hardware-gated)

- **Phase 0** ✅ 🧪 — Glue + flag vs a *fake* engine: a testable mount factory (local backend → `createVoiceMode`
  → `turnRun`) + the `message`/`message.delta` → `speak()` output wiring; bootstrap selects local when
  available, else the existing Vapi/stub. No regression: Vapi untouched when local is unavailable.
- **Phase 1** ✅ 🧪/🎧 — VAD-only engine: the ≤80ms ear-perk + mic lifecycle (proves near-zero-idle). COOP/COEP
  (credentialless). Activate: `RORO_VAD_VOICE=1 npm start`.
- **Phase 2** ✅ 🧪/🎧 — STT: whisper **base.en** over the VAD's `onSpeechEnd` PCM via `@huggingface/transformers`
  v3 (`onnx-community/whisper-base.en`, dtype q8, threaded-SIMD WASM, `proxy` worker). Partials → caption tell
  (TextStreamer deltas, accumulated to cumulative); committed final → `turnRun`. Guards: English-only model
  (no `language`/`task`), non-speech-annotation drop (`[Music]`/`[BLANK_AUDIO]`), mute-taint (a mute *during*
  decode drops the final), deaf-cat mute (engine `setMuted` skips STT). ORT wasm self-hosted in `public/ort/`
  — DISTINCT from Silero's `public/vad/` (transformers ORT 1.22 vs vad-web 1.27, non-interchangeable). Weights
  download-from-HF + Cache-API (credentialless permits it). Activate: `RORO_STT_VOICE=1 npm start`. *(WASM-vs-
  WebGPU profiling gate + small.en WebGPU upgrade remain a follow-up.)*
- **Phase 3** ✅ 🧪/🎧 — TTS + lipsync: Kokoro-82M **raw-ONNX** via `@huggingface/transformers` (NOT
  kokoro-js — it statically bundles GPLv3 eSpeak). G2P via **`phonemize`** (MIT, pure-JS) + the load-bearing
  `ɫ→l, ɝ→ɚ` normalizer (those two symbols aren't in Kokoro's 115-char vocab; it silently drops them).
  Sentence-streamed; `AnalyserNode` RMS → the driver's `AmplitudeLipSync` (one utterance at a time); stop()
  is barge-in-ready (never closes the shared AudioContext). **No-GPL license firewall** (lockfile ban +
  bundle scan + positive control). ORT wasm reuses `public/ort/` (same transformers 1.22 — no skew). Weights
  download-from-HF (offline-staging is a follow-up). Activate: `RORO_TTS_VOICE=1 npm start`.
- **Phase 4** 🧪/🎧 — Audio-level barge-in: talk over the cat → the engine halts its own TTS.
- **Phase 5** 🧪/🎧 — Voice packs: injectable Kokoro voice id; free `af_heart` + paid voice bundles (the
  cosmetics bridge).

**Roadmap fit:** voice is the **last local substrate** (brain ✓ Ollama, memory ✓ rebuilt) → Roro becomes
fully local-first, $0-idle, end-to-end → then the cosmetics phase, which Phase 5 opens.
