# Roro — Run & Integration Guide

Roro is **local-first**: the brain runs on a local Ollama daemon and memory is an
in-process PGlite + pgvector store. The default path needs **no API keys** and makes
no network calls. The steps below bring the full app alive on your Mac.

## 1. Local brain — install Ollama + pull models

```sh
ollama serve                  # macOS: Ollama.app starts this automatically
ollama pull qwen2.5:3b        # reasoning (decide)
ollama pull qwen2.5vl:7b      # vision (describeScreen) — needs substantial RAM (~13-17GB)
ollama pull nomic-embed-text  # embeddings (768-dim)
```

On boot, `main` runs a non-blocking brain preflight: success logs the active model;
failure (daemon down / model missing) still renders the window and surfaces a
diagnostic — it never silently falls back to the cloud. Verify end-to-end with the
opt-in smoke: `OLLAMA_AVAILABLE=1 npx vitest run src/brain/integration.test.ts`
(see [`docs/WS1-OLLAMA-INTEGRATION-TEST.md`](docs/WS1-OLLAMA-INTEGRATION-TEST.md)).

## 2. Optional `.env` — tuning + the Nebius escape hatch

Copy [`.env.example`](.env.example) to `.env` only if you want to change models or opt
into cloud. Defaults work with no `.env`.

```
BRAIN_PROVIDER=ollama          # default; set to 'nebius' for the cloud escape hatch
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_EMBED_DIM=768           # set this if OLLAMA_EMBED_MODEL is not 768-dim

# Only used when BRAIN_PROVIDER=nebius:
NEBIUS_API_KEY=...
NEBIUS_MODEL=deepseek-ai/DeepSeek-V3.2
NEBIUS_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct
NEBIUS_EMBED_MODEL=Qwen/Qwen3-Embedding-8B

RORO_WORKDIR=/abs/path/to/scratch-git-repo   # the repo the agent actually codes in
ANTHROPIC_API_KEY=...                          # only if you use the Claude executor
```

> Switching the embed model changes the vector geometry. `OLLAMA_EMBED_DIM` must match
> the model's output (preflight probes it and fails loud on a mismatch), and the memory
> store's `vector(N)` column is fixed at creation — re-embedding is not automatic, so
> move/delete the memory dir when changing embedders.

## 3. Memory — local PGlite + pgvector (no setup)

Memory is an in-process PGlite database with pgvector, stored under the app's userData
dir (override with `RORO_DB_DIR`). It is owner-scoped and survives restarts — **no
external database, no SQL provisioning, no keys**. A taught fact in one launch is
recalled in the next (proven by `src/memory/crosslaunch.persistence.test.ts`).

## 4. The avatar — a hand-built pixel-art cat (default; no assets needed)

The character is Roro, a procedurally-drawn 16-bit pixel cat that ships **in code** — it
animates through agent state with posture (stands / sits / **walks** while working) and
needs **no model files**. It renders out of the box.

> **Optional — swap in a Live2D model.** Drop `live2dcubismcore.min.js` + a Cubism-4
> model into `public/live2d/` and point `modelUrl` at it (see `public/live2d/README.md`).
> The model-agnostic `CharacterDriver` facade drives either one.

## 5. Voice (optional today: Vapi; local voice is Phase D)

Voice currently uses Vapi (hosted). The local-voice control core + `VoiceBackend` seam
are built (Phase D); the on-device whisper.cpp/Silero/Kokoro adapter + Voice Mode UI land
on a machine with the native binaries + a mic. For the Vapi path, inject renderer config
(in `index.html` before the bundle, or via preload):

```js
window.RORO_CFG = {
  vapiPublicKey: '...', customLlmUrl: '<ngrok-https-root>',
  voiceId: '<11labs-id>',
  // modelUrl is OPTIONAL — only if you added a Live2D model (§4).
};
```

## 6. macOS permissions

Grant **Microphone** + **Screen Recording** to the launching binary; **relaunch** after
granting (TCC grants bind to the app/signing identity).

## 7. Run

```
npm install
npm start
```

Summon (Cmd+Shift+Space) → type a task in the floating Ask (or the dev prompt box) → the
cat thinks (driven by the local brain's content stream) → drives Codex in `RORO_WORKDIR`
(each action narrated + animated) → writes to local PGlite memory. Then ask
*"what did we do?"* for the pgvector recall beat.

### Optional floating character window

```
RORO_FLOATING_WINDOW=1 npm start
```

Shrinks the window, removes the frame, makes the background transparent, hides every
overlay so only the cat shows, and keeps Roro above normal windows across macOS Spaces.
**Tap or hold to pet, drag to move, right-click to mute.**

## Verify

- `npx tsc --noEmit -p tsconfig.json` → 0 errors
- `npx vitest run` → 190 passing (+4 opt-in live-brain tests, skipped without `OLLAMA_AVAILABLE=1`)
- `npm run verify:floating` → on-screen smoke for the floating Ask (needs a display)

## Known notes

- The local Ollama path streams the decision as **content** (no separate
  `reasoning_content` channel), so the "thinking" pose is driven by content deltas; under
  `BRAIN_PROVIDER=nebius`, `reasoning_content` drives a live reasoning caption.
- The Claude executor path is unit-checked; smoke-test once `ANTHROPIC_API_KEY` is set.
- Binary path overrides: `RORO_CODEX_BIN`, `RORO_CLAUDE_BIN`. Debug CDP port:
  `RORO_DEBUG_PORT`. (Legacy `COMPANION_*` names still work with a deprecation warning.)
