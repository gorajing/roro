# Roro

**A black pixel-cat coding agent with a face, a voice, and a memory.**

Roro is an Electron app where an animated black pixel cat listens to a task,
thinks through it with a **local Ollama brain**, drives a real coding agent,
narrates the work as it happens, and stores what happened in **local PGlite +
pgvector memory** — all on-device by default.

Built for the June 19 Midsummer Multimodal AI Hackathon; now **local-first**.

```text
ask -> recall memory (local) -> think on local Ollama -> run Codex or Claude -> remember the result (local)
```

Post-demo, the product direction is pet-first: Roro should become the best
desktop AI pet, with coding as one useful trick. See
[`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md).

## Why This Exists

Most coding agents still feel like command-line tools with better autocomplete.
Roro makes the agent loop visible and social:

- the cat changes posture when the system is listening, thinking, working, done,
  or stuck
- the brain's decide phase appears as the "thinking" layer
- executor output becomes a normalized action timeline
- local memory recall is surfaced as a visible memory beat
- the same character layer can run inside the full app or as a transparent
  floating desktop agent

The intended demo is simple: ask the character to fix a bug, watch it plan, watch
it run the coding agent, then ask what it remembers from the earlier turn.

## The Cat

The default character is a procedural 16-bit tuxedo cat drawn with PixiJS in
[`src/renderer/character/avatar.ts`](src/renderer/character/avatar.ts). It does
not need image assets or model files.

The base cat uses a tight four-color palette: black body, white tuxedo and paws,
yellow eyes, and gray inner ears. State effects deliberately expand that palette:
cyan for listening and talking, gold for thinking, blue for work motion, green
and gold for success, and red/orange for errors.

| State | Behavior |
| --- | --- |
| `idle` | breathes, blinks, twitches ears; floating mode slowly cycles stand/sit/walk |
| `listening` | perks up and shows signal pixels |
| `thinking` | sits, looks upward, shows thought pixels |
| `working` | walks with a leg cycle and turns before reversing direction |
| `done` | shows success sparkles |
| `error` | flattens ears and shows alert pixels |
| talking layer | opens the mouth and adds signal pixels while speech is active |

The renderer talks to a model-agnostic `CharacterDriver`
(`setState`, `setMouthOpen`, `setTalking`, `speak`), so a Live2D model can still
be mounted later behind the same interface.

## How It Works

```mermaid
flowchart LR
  user["User task<br/>voice or text"] --> renderer["Renderer<br/>cat, captions, controls"]
  renderer --> main["Electron main<br/>typed IPC"]
  main --> memoryRecall["PGlite recall<br/>pgvector (local)"]
  memoryRecall --> brain["Local Ollama brain<br/>qwen2.5 decision"]
  brain --> executor["Executor adapter<br/>Codex or Claude"]
  executor --> events["Canonical action events"]
  events --> renderer
  events --> memoryWrite["PGlite remember (local)"]
  brain --> vision["Local vision<br/>optional screen read"]
```

| Subsystem | Role | Source |
| --- | --- | --- |
| Electron shell | windowing, IPC, macOS permission checks, floating mode | [`src/main/`](src/main/) |
| Character | pixel cat, state machine, lip sync facade | [`src/renderer/character/`](src/renderer/character/) |
| Brain | local Ollama reasoning/vision/embeddings (Nebius escape hatch) | [`src/brain/`](src/brain/) |
| Memory | PGlite + pgvector remember/recall (local, owner-scoped) | [`src/memory/`](src/memory/) |
| Executor | Codex and Claude stream adapters | [`src/executor/`](src/executor/) |
| Voice | Vapi web client + the local-voice seam (Phase D) | [`src/renderer/voice/`](src/renderer/voice/) |
| Shared contracts | typed IPC, action events, avatar states | [`src/shared/`](src/shared/) |

The important boundary is the canonical action-event vocabulary in
[`src/shared/events.ts`](src/shared/events.ts). The renderer does not parse raw
Codex or Claude output; it only reacts to normalized events like `command`,
`file_change`, `message`, `run.completed`, and `run.failed`.

## Quick Start

```bash
# 1. Start the local brain (Ollama) and pull the default models:
ollama serve
ollama pull qwen2.5:3b        # reasoning
ollama pull qwen2.5vl:7b      # vision
ollama pull nomic-embed-text  # embeddings (768-dim)

# 2. Run the app:
npm install
npm start
```

On boot Roro runs a non-blocking brain preflight; if Ollama is down or a model is
missing, the window still opens and a clear diagnostic appears (it never silently
falls back to the cloud). See
[`docs/WS1-OLLAMA-INTEGRATION-TEST.md`](docs/WS1-OLLAMA-INTEGRATION-TEST.md).

For the floating desktop agent:

```bash
RORO_FLOATING_WINDOW=1 npm start
```

The floating mode opens a transparent, frameless 380x400 window that hides all
controls and shows only the cat. **Tap or hold the cat to pet it; drag to move it;
right-click to mute.** The cat's body carries only affection + move — talk and
tasking live off the body (see the interaction design spec at
[`docs/superpowers/specs/2026-06-20-nero-interaction-design.md`](docs/superpowers/specs/2026-06-20-nero-interaction-design.md)).
The floating window stays above normal windows and across macOS Spaces,
including full-screen apps. Use the normal app window when you need to give Roro a
task (typed prompt), call controls, captions, and the action timeline.

## Configuration

Roro is local-first and needs **no keys** for the default (Ollama + PGlite) path.
A local `.env` (see [`.env.example`](.env.example)) can tune models or opt into the
Nebius cloud escape hatch:

```bash
# Brain provider: 'ollama' (default, local) or 'nebius' (cloud escape hatch).
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_EMBED_DIM=768            # set this if OLLAMA_EMBED_MODEL is not 768-dim

# Optional: only used when BRAIN_PROVIDER=nebius.
NEBIUS_API_KEY=...
NEBIUS_MODEL=deepseek-ai/DeepSeek-V3.2
NEBIUS_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct
NEBIUS_EMBED_MODEL=Qwen/Qwen3-Embedding-8B

RORO_WORKDIR=/absolute/path/to/scratch-git-repo
ANTHROPIC_API_KEY=...           # optional, only for the Claude executor
```

Memory is local PGlite + pgvector under the app's userData dir (`RORO_DB_DIR` to
override) — no external database. See [`RUN.md`](RUN.md) for the Vapi proxy notes,
macOS permissions, and the full live-run checklist.

> Migrating from an older checkout: the internal env prefix was renamed
> `COMPANION_*` → `RORO_*` (and `VITE_COMPANION_FLOATING_WINDOW` →
> `VITE_RORO_FLOATING_WINDOW`). The old names still work for now (a deprecation
> warning is logged); update your `.env`/scripts at your convenience.

## Development

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run                   # 190 passing (+4 opt-in live-brain tests, skipped without OLLAMA_AVAILABLE=1)
npm run verify:floating          # on-screen smoke for the floating Ask (needs a display)
npx electron-forge package
```

## Status

What is working:

- Electron app builds and packages
- typed IPC between renderer and main
- procedural pixel cat, transparent floating mode, and state effects
- **local Ollama brain** (decide/vision/embeddings) — verified end-to-end against a
  live daemon; Nebius remains as a `BRAIN_PROVIDER=nebius` escape hatch
- **local PGlite + pgvector memory** (owner-scoped, survives restarts)
- Codex and Claude executor adapters behind one event stream
- typed text path + the Phase D local-voice control core/seam

What needs extra setup or a real device:

- Vapi call flow and microphone permission (the on-device whisper/Silero/Kokoro
  voice adapter lands on a machine with the native binaries + a mic)
- screen capture permission for vision (the 7B vision model needs substantial RAM)
- optional Live2D model swap

## Project Shape

```text
src/main/                 Electron main process and orchestration
src/renderer/             UI, character, voice, captions, event wiring
src/brain/                local Ollama decision, vision, embeddings (Nebius escape hatch)
src/memory/               local PGlite + pgvector memory read/write
src/executor/             Codex and Claude adapters
src/shared/               IPC, event, memory, avatar, env contracts
public/live2d/            optional Live2D assets
RUN.md                    live setup and integration guide
```
