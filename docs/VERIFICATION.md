# On-screen verification (WS4) — Phase B floating Ask + Stop

The floating Ask (`#floating-ask`) and Stop pill (`#floating-stop`) carry their decision logic in pure
modules (`askMachine`, `runLifecycle`) that are unit-tested, plus a jsdom DOM shell test. But **jsdom
has no CSS layout/visibility**, so the collapsed/expanded/tasked + `.armed` *rendering* — the part a
real user sees — has never been verified in the running app (HANDOFF §8 #2: "on-screen check owed").

Two ways to verify, below. The automated smoke is the fast path; the manual checklist is the
authoritative fallback and what to run when changing `floatingAsk.ts` or `src/index.css`.

## Automated smoke (CDP)

```sh
npm run verify:floating
```

`scripts/smoke-floating-ask.mjs` launches the real Electron renderer over the Chrome DevTools Protocol
(via the built-in `COMPANION_DEBUG_PORT` hook) and asserts the rendered DOM **and computed CSS
visibility**, then writes `docs/verification/floating-ask.png`. It is opt-in (needs a display + a vite
build) and not in CI. Checks: `#floating-ask` exists + starts `collapsed`; pill reads "Ask Roro…";
`#floating-stop` exists and is not `armed`; clicking the pill → `expanded` with the input actually
visible (`getComputedStyle().display !== 'none'`); Escape → `collapsed`.

## Manual checklist

Start the app (`ollama serve` first if you want a real turn): `npm start`.

| # | Action | Expected on screen |
|---|--------|--------------------|
| 1 | App boots | Collapsed "Ask Roro…" pill visible; no Stop pill; cat idle |
| 2 | Click the pill (or ⌘⇧Space) | Input expands and is focused; pill chrome hidden |
| 3 | Press Enter on an **empty** input | Nothing happens — no thinking flash, stays expanded |
| 4 | Type "add a logout route" + Enter | Cat snaps to *thinking* immediately (<100ms); pill shows `tasked: add a logout route` |
| 5 | While a `run_agent` turn runs | `#floating-stop` appears with the `armed` class (visible) |
| 6 | Click Stop | Run cancels; Stop disarms/hides; Ask collapses back to the pill |
| 7 | An answer/clarify turn (no executor run) | Ask still collapses when the turn ends (universal `runEnd`) |
| 8 | Press Esc while expanded | Collapses back to the "Ask Roro…" pill |

A CSS regression shows up as: a state that doesn't visually change (e.g. input stays hidden when
`expanded`), the Stop pill not appearing when `armed`, or the pill text not updating to `tasked: …`.

> **Environment note:** the automated smoke needs a GUI session; it cannot run on a headless CI box.
> When verifying from a non-GUI context, use the manual checklist on a machine with a display.
