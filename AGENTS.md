# AGENTS.md

## Current Project Shape

Roro is a local-first Electron desktop app. The default brain is local Ollama,
memory is encrypted local files-as-truth with a derived PGlite index, and coding
turns run through the user's own local Codex or Claude CLI.

Do not add a hosted backend, account system, telemetry, payments, or app-owned
cloud model dependency unless the user explicitly asks for that product change.
Historical hosted-demo material (the predecessor cloud stack) lives in git
history only, not the current architecture.

## Working Rules

- Read [`FOUNDING.md`](FOUNDING.md) first (identity, locked invariants, strategy
  of record). Trust it plus [`HANDOFF.md`](HANDOFF.md), [`PUBLIC.md`](PUBLIC.md),
  and [`README.md`](README.md) over older docs when they conflict; expensive
  lessons live in [`LESSONS.md`](LESSONS.md).
- Keep the `turnRun` path as the single recall -> decide -> execute/narrate ->
  remember chokepoint.
- Keep memory fail-loud: never add a plaintext fallback if OS keychain storage
  is unavailable.
- Do not commit `.env`, `.env.local`, `.insforge/`, generated voice/model assets,
  packaged output, or local userData.
- For release work, distinguish the unsigned/ad-hoc verification path from the
  human-owned Developer-ID notarized build gate.
