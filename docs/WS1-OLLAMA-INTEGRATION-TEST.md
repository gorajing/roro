# Verifying the local Ollama brain (WS1)

Roro's brain is **local-only**: every brain call —
`decide`, `embed`, `describeScreen` — runs against a local [Ollama](https://ollama.com) daemon
(`BRAIN_PROVIDER` unset or `ollama`; any other value fails loud with a typed error — the old cloud
fork was deleted in #139). The
unit suite mocks/injects the embedder, so this runbook is how you confirm the **real** local stack
works end-to-end on your machine.

## Prerequisites

1. Install Ollama and start the daemon:
   ```sh
   ollama serve            # leave running (Ollama.app starts it automatically on macOS)
   ```
2. Pull the default models:
   ```sh
   ollama pull qwen2.5:3b          # reasoning (decide)
   ollama pull nomic-embed-text    # embeddings (768-dim) — memory
   ollama pull qwen2.5vl:7b        # vision (describeScreen)
   ```
   To use different models, set `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL` / `OLLAMA_VISION_MODEL`. If the
   embed model isn't 768-dim, also set `OLLAMA_EMBED_DIM` to its dimension (the schema + provenance
   stamp follow it; `preflight()` probes the embedder and fails loud on a mismatch).

## Automated smoke test (opt-in)

`src/brain/integration.test.ts` hits the live daemon. It's **skipped by default** so normal
`npm test` / CI never blocks on a daemon or multi-GB pulls. Run it explicitly:

```sh
OLLAMA_AVAILABLE=1 npx vitest run src/brain/integration.test.ts
```

It verifies: the daemon is reachable + models present (`preflight`), `decide()` streams content and
returns a well-formed `Decision`, `embed()` returns a finite 768-dim vector, and `describeScreen()`
captions a synthetic image. Respects `OLLAMA_HOST` (default `http://127.0.0.1:11434`).

> **Vision RAM note:** `qwen2.5vl:7b` needs substantial memory (~13–17GB resident). On a
> memory-constrained machine the runner OOMs ("model runner has unexpectedly stopped … resource
> limitations"); the vision case **skips with that reason** rather than failing. `decide` + `embed`
> (the turn-critical paths) are far lighter and run on modest hardware.

## In-app check

```sh
ollama serve   # ensure the daemon is up first
npm start
```

On boot, `main` runs a **non-blocking** brain preflight (`src/main.ts` → `verifyBrainAtStartup`):
- Success: the terminal logs `[main] brain preflight OK — <model> (local Ollama); models: …`.
- Failure (daemon down / model missing): the window still renders, the terminal logs the error, and
  a `⚠️ Local brain unavailable: …` caption appears in the app — turns fail loud with the remedy
  instead of hanging. (The window is never blocked, so the UI is still inspectable.)

Then type a prompt and watch a real turn: the planning beat names the **actual** model
(`<model> (local Ollama) is planning the task…`) and the cat holds the *thinking* pose during
`decide` (driven by the content stream, since Ollama has no separate reasoning channel).
