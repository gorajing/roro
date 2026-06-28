# Roro Interaction Contract

Roro's v0 interaction model is job-first: the user chooses a project, types a
task, watches the cat narrate the agent loop, and sees useful memory carried
forward across sessions.

## Current Surface

- Text is the default input. Voice remains a hidden developer seam behind flags.
- The full app window owns setup, prompt, captions, memory, and timeline.
- The floating window is a compact task surface: cat, setup banners when needed,
  and the Ask pill.
- The cat body handles presence and affection only: tap or hold to pet, drag to
  move. Tasking stays in the prompt/Ask surfaces.
- The app must show actionable readiness states before work: local brain status,
  selected project, selected executor, and memory/keychain health.

## Turn Contract

Every user task flows through the same main-process `turnRun` path:

```text
recall local memory -> decide with local brain -> execute or narrate -> remember locally
```

Renderer surfaces should show normalized action events from that path rather
than parsing executor-specific output.

## Privacy And Trust Cues

- Do not imply always-on monitoring. Screen reads are explicit and show the
  "Taking one screen snapshot." tell.
- Do not imply cloud sync or app-owned model keys in the default path.
- Do not ship visible controls for features that are cut from v0.
- If memory is unavailable, show a keychain/memory diagnostic instead of
  silently storing plaintext.

Older interaction research lives in `docs/superpowers/`. Treat it as background
unless it has been reconciled with `HANDOFF.md`, `PUBLIC.md`, and this file.
