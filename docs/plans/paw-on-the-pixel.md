# Plan — the paw-on-the-pixel wedge

*roro's defining wedge (see `docs/strategy/01-vision.md`): you point at a thing on your screen and ask; roro points a paw back at the exact pixel and answers, on your screen, over any app, entirely local.* This plan is grounded in the real roro codebase (four parallel architecture readers, July 2026).

## 0. The one sentence
**Ask roro about something on your screen → it captures the screen locally → qwen2.5-VL grounds your phrase to a pixel → a paw + ring lands on that exact pixel while the cat looks toward it → roro says the short answer.** Point to ask, point to answer.

## 1. The flow (user experience)
1. **Summon + ask.** You hit ⌘⇧Space (or click the pill) and say/type *"where's the merge button?"* / *"what's wrong here?"* / *"what is this?"*. (Reuses the existing Ask input → `turnRun`.)
2. **Consent tell.** roro shows its existing *"Taking one screen snapshot."* beat and its eyes open — one metered glance, never continuous. (Reuses `SCREEN_CAPTURE_STATUS_TEXT`.)
3. **Ground.** Locally, qwen2.5-VL locates your phrase → a tight box (or "I can't find that").
4. **Point.** A translucent paw + a soft ring lands on the exact pixel over whatever app is there; the cat (in its own corner) turns to look toward it. If grounding is uncertain, the ring is **wide** ("around here") — never a confident wrong paw. It auto-fades after a few seconds; it never blocks or captures clicks.
5. **Answer.** roro speaks/shows the short plain-language answer (the existing capture→re-decide→answer path).

**Restraint & honesty rules baked in:** one glance per ask (never continuous watching); the paw fades and asks nothing; uncertain grounding → wide halo, fail-loud; roro points, never clicks (point-don't-act).

## 2. Architecture — what already exists vs. what's new

### Reuse (already in the codebase)
- **Screen capture** — `src/vision/index.ts` `captureScreen()`: `screencapture -x -t png -D 1` → black-frame guard → downscale to `MAX_CAPTURE_WIDTH=1280` → `{ b64, mime }`. Already main-owned and product-safe (renderer capture stays debug-only).
- **The chokepoint seam** — `src/main/orchestrator.ts` `actOnDecision` `case 'capture_screen'` (≈:520-577): push the tell → dwell → `vision.askScreen` → re-`decide` once → re-dispatch. This is where grounding + the point-push attach. **Do NOT fork `turnRun`; do NOT add a `Command` variant** — `capture_screen` already exists (locked-union invariant).
- **The point primitive** — `CH.cursorMove` push: `startCursorTracking` (`src/main/window.ts`) converts the OS cursor to a normalized `GazeTarget∈[-1,1]` via `cursorToGazeTarget(pt, bounds, reach)` (`src/shared/gaze.ts`) → `driver.setGaze` eases the eyes. **A new point channel mirrors this exactly.**
- **Ask + voice intent** — `floatingAsk.ts submitIfReady → startTurn → companion.turnRun`; voice (opt-in) routes to the same `turnRun`.
- **Ollama vision call** — `src/brain/index.ts describeScreen()` → `ollamaChat({ model: qwen2.5vl:7b, images:[b64], stream:false })` via `src/brain/ollama.ts` (`images: string[]` on the chat message). `parseDecision` (`src/brain/index.ts`) is the JSON-parse template to copy for a box parser.
- **Default-DENY IPC + consent tell** — `src/main/ipc.ts` / `src/preload.ts`; capture stays in MAIN, the renderer only receives a point (read-screen + point-cat = point-don't-act compliant).

### Build (the load-bearing gaps)
1. **Grounding: phrase → pixel box.** Today `askScreen` discards the phrase (`void prompt`) and `describeScreen` returns a caption, not coordinates. New: `brain.groundTarget(image, phrase) → { box } | null` — a grounding prompt to qwen2.5-VL (it has native bbox grounding) + a JSON-box parser (mirror `parseDecision`), returning normalized coords + a confidence. Fail-loud: no box → `null`.
2. **Coordinate metadata + the back-transform.** `captureScreen` returns only `{b64,mime}` — it drops the display, its physical size, its `scaleFactor`, and the downscale ratio. Extend it to also return `{ displayId, physicalW/H, scaleFactor, capturedW/H }`, then map: `modelBox (in capturedW space) → ÷ downscaleRatio → physical px → ÷ scaleFactor → DIP within display → + display.bounds.x/y → global DIP point`. **This is the #1 correctness risk** — every coordinate step is a chance to be off.
3. **The pointing surface: a second click-through overlay window.** roro's pet window is 190×200, aspect-locked, and has *no* OS click-through (it's faked with CSS, which only works because it's tiny). Rather than expand/contort the pet window (which would balloon the PixiJS cat and break the drag/gaze/summon assumptions), add a **dedicated, disposable overlay window**: transparent, frameless, `alwaysOnTop('screen-saver')`, `setVisibleOnAllWorkspaces`, `focusable:false`, **`setIgnoreMouseEvents(true,{forward:true})`** (true OS click-through), no aspect lock, bounds = the target display. It renders only a paw + ring + short caption at the mapped pixel, then hides. The pet window is untouched.
4. **A `point` driver method + a paw render.** `setGaze` (eyes) exists; a paw-point is net-new. `AvatarState` is frozen at 6 states → a point is a transient **driver method** (like `pet()`/`poke()`), never a 7th state. For v0 the paw lives on the *overlay* renderer (drawn at the pixel); the pet cat reuses `setGaze` to look toward it.
5. **One new IPC channel.** `CH.point` (main→renderer push to the overlay) carrying `{ x, y, confidence }` in overlay-local coords + the answer/label. Registered unconditionally (not debug-gated — it's a product capability). No frozen-union change.

## 3. Key decisions (and why)
- **Overlay window, not move-the-pet-window.** The wedge is a paw landing *precisely on a pixel anywhere on screen* (the shareable "cat walks to the bug" moment). A moving 190×200 window can't land on a distant pixel; the overlay can, and it keeps the pet window's drag/gaze/summon/aspect logic untouched. (This is also clicky's proven pattern.)
- **Reuse `capture_screen`, don't fork `turnRun`.** Grounding + point-push happen *inside* the existing `capture_screen` branch, honoring the single-chokepoint invariant and the tested capture-loop contract (single recall, tell-before-capture, tell-not-persisted, fail-loud on vision error — `orchestrator.captureScreen.test.ts`).
- **Point rides a new IPC channel, not the frozen unions.** Precedent: confirm/deny already rides its own IPC pair rather than an `ActionEvent` kind; `cursorMove` already pushes a target. `CH.point` mirrors them. No `Command`/`ActionEvent`/`AvatarState` change.
- **v0 = primary display only.** roro's `captureScreen` already grabs display 1; multi-display (union-bounds overlay, per-display scaleFactor) is a follow-up.
- **Fail-loud grounding.** Uncertain → wide "around here" halo; no box → say "I can't find that" and show no paw. A confident wrong paw is the one unacceptable failure.

## 4. Scope
**v0 (this plan — end-to-end, testable):** typed/spoken ask → capture → ground (VL box) → transform (primary display) → overlay paw+ring at the pixel + cat looks toward it → auto-fade → spoken answer. Fail-loud on low confidence / no VL model / black frame.

**Follow-ups (not v0):** the full PixiJS cat *flying across* the overlay (v0 = paw+ring); the **drop-to-refer** third gesture verb (drag the cat onto a thing = the referent) — a third verb in `installFloatingWindowGesture`, using the `pointerup` screen coord; **hold-to-talk** (voice `summon()`/`unsummon()` on pointer down/up); multi-display; the second-encounter *recall* ("you pointed here before").

## 5. Implementation plan (ordered; each step has a verification gate)

1. **Grounding brain fn (pure, unit-tested first).** Add `groundTarget(image, phrase)` to `src/brain/index.ts` + a `GROUND_PROMPT` + a `parseGroundBox` JSON parser (mirror `parseDecision`), returning `{ box:{x,y,w,h} normalized, confidence } | null`. *Verify:* unit tests for the parser (valid box, "not found" sentinel, garbage → null) — a failing-then-passing test.
2. **Thread capture metadata + the transform (pure, unit-tested).** Extend `captureScreen()` to also return `{ displayId, physicalW, physicalH, scaleFactor, capturedW, capturedH }` (from `screen.getAllDisplays()` + the sharp resize result). Add a pure `groundBoxToDesktopPoint(box, meta, display) → {x,y} DIP` in a new `src/shared/` module. *Verify:* unit tests with known metadata (e.g. 2× retina, 1280-downscaled) asserting exact DIP output — the correctness core.
3. **The overlay window (main).** Add an overlay factory in `src/main/` (fork the pattern from `window.ts`, minus aspect lock, plus `setIgnoreMouseEvents(true,{forward:true})`, `focusable:false`, bounds = primary display). Create lazily on first point, reuse a tracked reference (so `registerSummonShortcut`'s `getAllWindows()[0]` + the mute loop don't grab it — switch those to a tracked pet-window ref). A minimal overlay renderer (query-param mode on the existing renderer, or a tiny separate HTML) draws a ring+paw at a target it receives. *Verify:* a smoke that opens the overlay, pushes a target, and asserts (CDP) the overlay is click-through + the ring renders at the pushed coords.
4. **Wire capture_screen → ground → point.** In `orchestrator.ts` `capture_screen`: after capture, call `groundTarget(transcript)`; if a box, transform to a DIP point and push `CH.point` to the overlay + `setGaze` toward it on the pet; keep the existing re-decide→answer. Fail-loud on null. *Verify:* the existing `orchestrator.captureScreen.test.ts` still passes + a new test that a locate transcript yields a point-push with the transformed coords.
5. **`CH.point` channel + preload + overlay consumer.** Add `CH.point` to `src/shared/ipc.ts`, a `sendToWindow(overlay, CH.point, …)` in main, an `onPoint` in the overlay's preload/consumer, and the paw-ring render. *Verify:* end-to-end in the smoke.
6. **The cat looks toward it.** Reuse `cursorToGazeTarget(targetPx, petBounds, reach)` → push to the pet's `setGaze` so the cat turns toward the target. *Verify:* the pet's gaze target updates on a point.
7. **Fail-loud paths.** No VL model (preflight checks it) → clear message + no paw; black frame → existing `BlackFrameError` copy; low confidence → wide halo. *Verify:* unit + a manual black-frame/no-model check.

## 6. Testing
- **Unit (vitest):** the box parser, the coordinate transform (the correctness core), the grounding-null path, the orchestrator capture_screen contract.
- **Computer-use (CDP + screencapture):** launch roro with a known target on screen (a button at a known pixel), ask *"point at the X"*, then (a) read the overlay's rendered ring coords via CDP and (b) `screencapture` the desktop and eyeball the paw landing on the target. Measure grounding accuracy on qwen2.5-VL:7b — if it's poor, that's a real finding (wide-halo honestly, and a note on whether the crop-and-zoom refinement from the clicky research is needed).
- **Lint + build**; then the review loop (codex max-effort) + iterate until the paw lands reliably.

## 7. Risks
- **VL grounding accuracy on 7B** (the clicky research flagged this). Mitigation: fail-loud wide halo; measure in the computer-use test; the crop-and-zoom second pass is the known accuracy lever if needed.
- **The coordinate transform** (retina scaleFactor + downscale + display origin). Mitigation: pure unit tests with known metadata; the computer-use test lands it on a *known* pixel.
- **Screen Recording permission** (macOS) — capture already handles this (`BlackFrameError` with a grant-permission message); surface it clearly.
- **Overlay perturbing window lifecycle** (`window-all-closed`, summon `getAllWindows()[0]`, the mute loop). Mitigation: lazy create/destroy + switch window lookups to tracked references.
