# @roro/voice — the on-device voice stack (standalone sub-package)

Roro's on-device voice pipeline: **Silero VAD** (ear-perk / turn detection, `@ricky0123/vad-web`) +
**whisper base.en STT** and **Kokoro-82M TTS** (both via `@huggingface/transformers` over ONNX-Runtime
WASM) + `phonemize` (the MIT G2P). Voice is **cut from v0** (PUBLIC.md): the shipped app is the typed
companion, and this package holds everything voice so the app never pays for it.

## Why this is NOT an npm workspace

This package is deliberately **outside the app's dependency graph**. The root `package.json` does not
list it in `workspaces` — npm auto-installs workspace deps, which would defeat the whole point: the
voice deps weigh **~510MB installed** (`@huggingface/transformers` ~155MB + its bundled
`onnxruntime-node` ~213MB + `onnxruntime-web` ~133MB + `vad-web` + `phonemize`). A fresh clone /
CI `npm ci` at the repo root installs none of it. Root tsconfig/eslint/vitest all exclude `packages/`.

## Dev workflow

```sh
cd packages/voice
npm install          # installs the voice deps HERE only (~510MB, one-time)
npm run typecheck    # tsc --noEmit against this package's tsconfig
npm test             # vitest run — includes the ttsLicenseFirewall GPL guard
```

CI: a **path-filtered** workflow (`.github/workflows/voice.yml`, `on: pull_request` with
`paths: ['packages/voice/**']`) runs `npm ci && tsc --noEmit && vitest run` in this directory — so the
GPL firewall and the voice suite stay alive without taxing every app build.

Model/runtime assets for a live voice session are staged by `scripts/stage-voice-assets.mjs`
(`npm run stage:voice-assets`, flag-gated by `RORO_VAD_VOICE` / `RORO_STT_VOICE` / `RORO_TTS_VOICE`).
It copies the WASM runtimes out of `node_modules` and downloads the pinned model revisions from
Hugging Face into `packages/voice/public/` (gitignored, regenerable, ~175MB for both models).

## Landmine 1: the ORT dual-build — NEVER merge `ort/` and `vad/`

Two **byte-incompatible** onnxruntime-web WASM builds coexist by design:

| dir (staged)  | consumer                                   | ORT build |
|---------------|--------------------------------------------|-----------|
| `public/vad/` | Silero VAD via `@ricky0123/vad-web`        | onnxruntime-web **1.27** (top-level dep) |
| `public/ort/` | whisper/Kokoro via `@huggingface/transformers` | onnxruntime-web **1.22.0-dev** (nested under `@huggingface/transformers/node_modules`) |

A 1.27 `.wasm` loaded by the 1.22 `.mjs` factory (or vice versa) fails with
`expected magic word 00 61 73 6d`. Hence separate staging dirs, separate sources, and the exact pins in
`package.json` (`@huggingface/transformers 3.8.1`, `@ricky0123/vad-web 0.0.30`, `onnxruntime-web 1.27.0`
pinned top-level so vad-web's copy can't drift). `onnxRuntimeEnv.ts` configures ONLY the transformers
instance; vad-web configures its own.

## Landmine 2: the GPL eSpeak trap — why the firewall scans SYMBOLS, not package names

Kokoro is a phoneme-input model. The popular G2P path (`kokoro-js` → `phonemizer`) **bundles
eSpeak-ng, which is GPLv3** — unshippable in Roro's MIT Electron bundle. The trap: `phonemizer`
*declares* Apache-2.0 in npm metadata while bundling GPL code in its dist, so a license-checker
that trusts declared licenses would wrongly pass it. `src/ttsLicenseFirewall.test.ts` therefore gates
two ways:

- **A) dependency-graph ban** — `phonemizer` / `kokoro-js` / `espeakng` etc. must not resolve in this
  package's `package-lock.json` at all;
- **B) bundle-content scan** — the shipped G2P (`phonemize`, MIT, pure-JS) must contain **zero
  eSpeak-specific symbols** (`espeak_ng_*`, `espeak_EVENT`, GPL license text), with a positive control
  so the detector can't rot into a silent pass.

We deliberately do NOT scan for the bare string `phonemizer` — `phonemize` (our MIT G2P) names an
internal object `phonemizer`, which is harmless.

## How voice re-integrates later (the seam)

The contract lives app-side in **`src/shared/voiceBackend.ts`** (`VoiceBackend` /
`VoiceBackendEvents`, types only). This package imports those types (plus the pure
`src/shared/voicePacks.ts` catalog and `src/shared/events.ts` ActionEvent) by relative path; the arrow
only ever points `packages/voice -> src/shared`, never the reverse. `characterSeam.ts` holds structural
mirrors of the two renderer shapes voice drives (`CharacterDriver.poke`, `CaptionSink`).

To re-integrate (in rough order — each item was removed app-side when voice was extracted, with the
removal commit as the reference):

1. **Deps/build**: add the voice deps back (or wire this package in properly), re-add the asset staging
   (`stage-voice-assets.mjs` output must land in the app's served `public/`), and re-add the forge
   package-time gates for the staged `vad/`/`ort/`/`models/` payloads.
2. **Mounting**: re-wire `mountLocalVoiceMode` / `activateVoice` / `createFakeVoiceEngine` /
   `createVadVoiceEngine` in `src/renderer/bootstrap.ts` (dynamic imports so WASM/model loads never
   touch non-voice users), plus the Voice Mode / Mute buttons in `index.html`.
3. **Flags**: restore the `RORO_{FAKE,VAD,STT,TTS}_VOICE` + `RORO_VOICE_PACK` env flags through
   `src/main/window.ts` roroCfg → `src/renderer/config.ts`, and re-add them to
   `src/shared/deferredEnvKeys.ts` + `scripts/v0-deferred-env.mjs` if voice remains deferred-gated.
4. **Mic / TCC**: restore `src/main/mic.ts` (macOS TCC gate + the two Chromium session permission
   handlers — getUserMedia falsely resolves when TCC is denied, so status MUST come from
   `systemPreferences.getMediaAccessStatus`), the `mic:status`/`mic:request` IPC channels + preload
   bridge, and the `voiceMicNeeded()` up-front consent call in `src/main.ts`.
5. **Cross-origin isolation**: restore `src/main/crossOriginIsolation.ts` (COOP `same-origin` + COEP
   `credentialless` on the renderer session) — SharedArrayBuffer + threaded-SIMD WASM (~3x) need it;
   `credentialless` (not `require-corp`) keeps the HF model downloads working.
6. **CSP**: re-add `'wasm-unsafe-eval'` to the `script-src` in `index.html` — the renderer's only WASM
   consumer was voice (PGlite runs in MAIN and is not governed by the renderer CSP).
7. **Entitlements**: re-add `com.apple.security.device.audio-input` to `build/entitlements.mac.plist`
   AND `NSMicrophoneUsageDescription` to the forge `packagerConfig.extendInfo` — a hardened-runtime
   signed build that touches the mic without BOTH crashes on first capture.
8. **Guards**: re-extend `scripts/verify-release-artifact.mjs` / `smoke-release-channel.mjs` if voice
   ships opt-in rather than default.
