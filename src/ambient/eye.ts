// src/ambient/eye.ts — the (gated, cut-from-v0) ambient eye, built DORMANT.
//
// One ambient read = capture the screen, describe it with the LOCAL vision model, and classify that
// description into the coarse AmbientObservation the belief-latch gates on. Nothing here runs by
// default: there is no loop, no timer, no caller — `observeOnce` only does anything when something
// passes it a capture + describe (kept injectable so it unit-tests with no screen and no model), and
// the whole feature stays behind a default-off gate + a visible "Taking one screen snapshot." tell
// (the existing capture_screen consent template) before it is ever wired live.

import type { AmbientObservation, AmbientKind } from './belief';

/** Destructive / irreversible commands — the eye flags these as `risk` over anything else on screen. */
const RISK_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\b[^\n]*\s(--force(-with-lease)?|-f)\b/, // force flag anywhere after `git push`, incl. refspec form
  /\bforce[- ]push/,
  /\bdrop\s+(table|database)\b/,
  /\btruncate\s+table\b/,
  /\bdelete\s+from\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-r\s+777\b/,
];

/** Something happened worth a look: a failure, a result, a state change. */
const CHANGE_PATTERNS: RegExp[] = [
  /\bfail(ed|ure|ing)?\b/,
  /\berror\b/,
  /\bexception\b/,
  /\bcrash(ed|ing)?\b/,
  /\bpassed\b/,
  /\bbuild\b/,
  /\btest(s)?\b/,
  /\bwarning\b/,
  /\b(changed|updated|appeared|opened|closed)\b/,
];

/** The screen is quiet — nothing to react to. */
const IDLE_PATTERNS: RegExp[] = [
  /\bidle\b/,
  /\bno (change|activity|new)\b/,
  /\b(static|unchanged|empty)\b/,
  /\bnothing (notable|happening|new)\b/,
];

const APP_HINTS: Array<[RegExp, string]> = [
  [/\bterminal|console|shell|command line\b/, 'terminal'],
  [/\beditor|vs ?code|cursor|vim|code file|source file\b/, 'editor'],
  [/\bbrowser|chrome|safari|firefox|web page\b/, 'browser'],
];

const matchesAny = (text: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(text));

function classifyKind(caption: string): AmbientKind {
  if (matchesAny(caption, RISK_PATTERNS)) return 'risk';
  if (matchesAny(caption, CHANGE_PATTERNS)) return 'change'; // a change/result outranks "looks idle"
  if (matchesAny(caption, IDLE_PATTERNS)) return 'idle';
  return 'unknown';
}

function detectApp(caption: string): string | undefined {
  for (const [pattern, app] of APP_HINTS) if (pattern.test(caption)) return app;
  return undefined;
}

/** Turn a vision-model caption into a coarse observation. PURE + deterministic. Safety-first:
 *  a destructive command reads as `risk` even if the caption also describes other activity. */
export function classifyObservation(caption: string): AmbientObservation {
  const c = caption.toLowerCase();
  return {
    kind: classifyKind(c),
    app: detectApp(c),
    what: caption.trim().slice(0, 200),
  };
}

export interface EyeDeps {
  /** Capture the screen → a base64 image (roro's main-side captureScreen in production). */
  capture: () => Promise<{ b64: string; mime: string }>;
  /** Describe the image with the LOCAL vision model → a short caption. */
  describe: (image: { b64: string; mime: string }) => Promise<string>;
}

/** One ambient read, end to end. Deps are injected so this tests with no screen and no model.
 *  DORMANT: nothing in the app calls this today — the ambient feature stays gated off. */
export async function observeOnce(deps: EyeDeps): Promise<AmbientObservation> {
  const image = await deps.capture();
  const caption = await deps.describe(image);
  return classifyObservation(caption);
}
