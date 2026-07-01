# Handoff — paw-on-the-pixel wedge

*Status snapshot for the next agent. Written 2026-07-01. Pairs with `docs/plans/paw-on-the-pixel.md` (the design) and `docs/strategy/01-vision.md` (why this is roro's wedge).*

## TL;DR

The **paw-on-the-pixel** wedge is **built, green, and computer-use-verified end-to-end.** Ask roro about something on your screen → it takes its one metered glance → qwen2.5-VL grounds your phrase to a pixel → a paw + ring lands on that exact pixel over any app, and roro says a short answer. Local, `$0`, offline-default.

- **Branch:** `feat/paw-on-the-pixel` (4 commits off `main` @ `45ac398`). **PR #135** open.
- **Green:** `npm test` → **902 pass / 5 skip**, `npx tsc --noEmit` clean, `npx eslint` → **0 errors** (warnings are pre-existing test-file non-null-assertions).
- **Proven live:** roro grounded *"the clock in the top-right corner"* → global **(2479, 101)** on a 2560×1440 screen (the correct corner). Full pipeline confirmed.
- **Review:** codex `review --base main` run twice; **5 real bugs** found and fixed, each with a regression test that fails against the old code. **A round-3 review was in flight at handoff** — see "Immediate next steps".
- **Untouched:** `src/renderer/character/gaze.ts` + `gaze.test.ts` are someone else's uncommitted WIP. **Do not stage or touch them.**

## What shipped (files, grounded in the real code)

| File | Role |
|---|---|
| `src/brain/index.ts` | `groundTarget(img, phrase)` → normalized box via qwen2.5-VL's **native `bbox_2d`** (pixel) format. `parseGroundResponse(raw, imgW, imgH)` is the **fail-safe** parser — any bad/absent box → `null` → **no paw** (never a confident wrong point). `GROUND_PROMPT` asks for pixel coords. |
| `src/shared/pointing.ts` | `groundBoxToDesktopPoint(box, displayBounds)` — normalized box → global **DIP** point. The correctness core: because the box is normalized to the full-display capture, the downscale ratio and DPI `scaleFactor` **cancel out** (direct scale into DIP bounds). |
| `src/vision/index.ts` | `captureScreen()` now also returns the JPEG `width`/`height` (from sharp) so pixel grounding boxes can be normalized per-axis. |
| `src/brain/locateGate.ts` | Deterministic routing (mirrors `clarifyGate`). Forces `capture_screen` + `args.locate` for **unambiguous** pointing intents (`point at/to`, `show me where`) OR `where is X <ui-noun>` **with explicit screen context**. Screen-reading and code questions fall through. |
| `src/main/pointerOverlay.ts` | The pointing surface: a dedicated desktop-wide, transparent, **OS-click-through** (`setIgnoreMouseEvents(true,{forward:true})`), focus-less, screen-saver-level overlay covering the primary display. Draws a transient ring+paw via `executeJavaScript` (no preload/IPC/2nd renderer). `showInactive()` + re-assert bounds so it paints and covers the menu bar. Low confidence → wide "around here" halo. Torn down on quit. |
| `src/main/orchestrator.ts` | Wires it into the existing `capture_screen` branch. **Fast locate path** (`args.locate`): ONE vision call — ground → point → short answer, skipping caption+re-decide. Grounding is **fail-loud** there (errors → `run.failed`, not masked as not-found); **Stop honored** after the awaits. Non-locate screen turns get a best-effort courtesy paw alongside the caption. |
| `src/main/siblings.ts` | `BrainModule.groundTarget` + `CaptureResult` dims threaded. |
| `src/main.ts` | `destroyPointerOverlay()` on `will-quit`. |
| tests | `src/brain/groundTarget.test.ts` (12), `src/shared/pointing.test.ts` (5), `src/brain/locateGate.test.ts` (5), `src/main/orchestrator.locate.test.ts` (4 — happy / null / fail-loud / Stop). |

## Invariants honored (do NOT break these)

- **No `turnRun` fork** — everything hangs off the existing `capture_screen` chokepoint.
- **No frozen-union change** — pointing is presentation (a driver-style overlay push), not a new `Command`/`ActionEvent`/`AvatarState`.
- **Point-don't-act** — reads the screen + points a paw only; no renderer→action.
- **Fail-loud** — uncertain/absent grounding → no paw or a wide halo, never a confident wrong paw; grounding *errors* on the locate path surface as `run.failed`.
- **One metered glance** — a locate turn captures the screen exactly once.

## Immediate next steps

1. **Read the round-3 codex verdict.** It was running at handoff. Re-run if needed:
   ```
   cd /Users/jinchoi/Code/roro && codex review --base main
   ```
   (codex leaves you on your branch; earlier runs returned cleanly to `feat/paw-on-the-pixel`.) The two prior rounds' findings (locate over-match ×2, prompt/parser scale, fail-loud, Stop) are all fixed + regression-tested — round 3 should be clean or only surface the known follow-ups below. Fix anything real the same way (root cause + a test that fails against the old code), commit, re-review until clean.
2. **Merge decision is the user's.** Once review is clean, the wedge is mergeable. PR #135.

## Known follow-ups (documented in the PR, not blockers)

- **Vision latency** — qwen2.5-VL:7b grounding is slow *and highly variable* on this hardware (~37s to >150s per call). It's the single biggest UX gap. Inherent to the local 7B; levers: a faster model / GPU, or the crop-and-zoom refinement (from the clicky research) which also improves small-element accuracy.
- **`screencapture` CLI can't see the overlay** — *verified*: the transparent GPU-composited overlay layer is invisible to the `screencapture` CLI (an **opaque** version IS captured, proving the window is on-screen). The **user sees the paw** (standard transparent-overlay pattern). **Open question worth confirming:** whether a real screen recorder (QuickTime/CleanShot) captures it — this matters for the shareable "cat walks to the bug" GIF, a core distribution mechanism.
- **v0 = primary display only.** Multi-display needs a union-bounds overlay + per-display bounds.
- **Presentation follow-ups:** the full PixiJS cat *flying across* the overlay (v0 = paw+ring); the **drop-to-refer** third gesture verb (drag cat onto a thing); **hold-to-talk** voice.

## How to computer-use test (the tooling + the gotchas)

roro is Electron, not a Chrome tab — drive it via the **Chrome DevTools Protocol** on `RORO_DEBUG_PORT`.

```
# launch DETACHED so it survives task cleanup (learned the hard way):
cd /Users/jinchoi/Code/roro
nohup env RORO_DEBUG_PORT=9223 npm start > /tmp/roro.log 2>&1 & disown
# wait for: grep "brain preflight OK" /tmp/roro.log
```

Scratchpad drivers (in `…/scratchpad/`, session-local — recreate if gone):
- `roro-cdp.mjs <port> eval "<expr>"` — eval in the pet renderer (click the ask pill, set `#ask-input`, submit `#floating-ask`).
- `roro-paw-test.mjs <port> "<phrase>"` — drives an ask, captures the event stream, then reads the overlay window's `window.__roroLastPoint` (drawn point) + computes the global screen coord. **This is the main verification tool** — its coordinate output is how "(2479,101)" was confirmed.
- `roro-overlay-shot.mjs` / `overlay-standalone.js` — draw the paw at a known point to inspect the render (note the screencapture caveat above).

**Gotchas that cost time — save yourself:**
- **Requires Ollama up with `qwen2.5vl:7b`, `qwen2.5:3b`, `nomic-embed-text`.** `ollama list` to confirm.
- **The vision call is SLOW and variable** — a "point at X" turn can take 40–150s. Wait on log conditions with an until-loop (`until grep -q '\[paw\]' /tmp/roro.log; do sleep 3; done`), never a fixed sleep. Don't nest many background waiters — they can cascade-kill roro (it dies with its launching task unless `nohup`+`disown`).
- **`screencapture` won't show the paw** (see above) — verify via the overlay's `__roroLastPoint` coordinate, not a screenshot.
- The memory store DEK is healthy (`memory warmup OK`). If it ever fails to decrypt (dev-vs-packaged keychain mismatch), move `key.json`+`encryption.json` in the userData dir to a `.locked-backup-*` and relaunch to mint a fresh DEK.

## The debugging trail (why the code looks the way it does)

Computer-use testing drove every non-obvious decision — don't undo these without re-checking:
1. The 3B **won't** reliably route "point at X" to `capture_screen` (it answered "I'll look at your screen" while emitting `answer`) → hence the deterministic `locateGate`.
2. qwen2.5-VL returns `{"found":false}` for a bespoke JSON schema but grounds well with its **native `bbox_2d`** → hence the prompt shape.
3. It returns **pixel** coords of the input image, not the 0-1000 I first asked for → hence dims threaded from `captureScreen` + per-axis pixel normalization (and the prompt now asks for pixels, matching).
4. `describeScreen` + `groundTarget` both hit the vision model and **Ollama serializes** them → ~2× latency → hence the single-vision-call locate path.
5. codex round 1: locate gate over-matched screen-reading Qs; prompt/parser scale mismatch. Round 2: gate still over-matched *code* Qs; grounding errors masked as not-found; Stop ignored mid-grounding. **All fixed + regression-tested.**
