# Roro Interaction Contract

Roro's v0 interaction model is job-first: the user chooses a project, types a
task, watches the cat narrate the agent loop, and sees useful memory carried
forward across sessions.

## Current Surface

- Text is the default input. Voice remains a hidden developer seam behind flags.
- The floating window is the default product surface: cat, setup banners when
  needed, and the Ask pill.
- The legacy full dev window (`RORO_FLOATING_WINDOW=0`) keeps the larger prompt,
  captions, memory panel, and action timeline visible for debugging.
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

## Gesture Design Laws (hard-won — see `LESSONS.md` "Interaction")

- Disambiguate gestures by **surface + button + state, never by timing windows**.
  Adding a verb means adding a menu item, never another timing threshold.
- An action's accidental-trigger probability must be **inversely proportional to
  its cost/irreversibility**.
- The cat body is **always pettable and never punishes**: petting is safe in
  every state and can never trigger an expensive or destructive action.
- Cursor gaze must **never wake the cat** — gaze follows the cursor, but only
  real interactions (pet, talk, task) reset the activity/sleep timer.

The older exploratory interaction research was deleted 2026-07-01 (git history,
`11a40f4` `docs/superpowers/`); anything still governing was reconciled into
`HANDOFF.md`, `LESSONS.md`, and this file.
