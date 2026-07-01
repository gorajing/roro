import type { Decision, DecideInput } from '../shared/brain';

// Deterministic routing for the paw-on-the-pixel wedge: a request to POINT AT / LOCATE / SHOW WHERE
// something is on the user's screen requires SEEING the screen, so it must route to capture_screen — but
// a local 3B decider is unreliable at inferring that (it often answers "I'll look at your screen" while
// emitting `answer`). This gate forces capture_screen for clear on-screen locate intents, exactly like
// clarifyGate forces clarify for referent-less requests. Once the screen HAS been captured (input.screen
// set), the gate stands down so the second decide() produces the real answer (no infinite capture loop).

// A locate intent needs a locate VERB *and* a concrete screen target — a UI-element noun ("save button")
// or explicit screen context ("on my screen") — and must NOT read as code navigation. This keeps repo
// questions on run_agent: "point to the auth middleware" / "show me where config is loaded" (no UI noun,
// no screen, code-ish) and "where is the login button implemented" (code phrasing) all fall through to the
// model. "point at the save button" / "where is the merge button on my screen" route to the paw.
//   isLocate = (POINTING with a screen target) OR (WHERE with screen context), minus code phrasing.
const POINTING_PATTERN = /\b(point (at|to)|show me where|locate)\b/;
const WHERE_PATTERN = /\bwhere (is|are|s)\b/;
const UI_NOUN_PATTERN =
  /\b(button|icon|menu|tab|field|link|toggle|checkbox|dropdown|logo|thumbnail|toolbar|window|dialog|banner|slider|cursor|scrollbar)s?\b/;
const SCREEN_CONTEXT_PATTERN = /\bon (the|my) (screen|display)\b/;
const CODE_CONTEXT_PATTERN =
  /\b(implement|implements|implemented|define|defined|declared|loaded|codebase|source code|in the (code|file|repo|function|method|class)|function|method|class|variable|module|import|endpoint|middleware|handler|component)\b/;

function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Force `capture_screen` when the request is a clear on-screen locate/point intent (and nothing has been
 *  captured yet). Returns null otherwise, so the normal model decision (and the post-capture answer) run. */
export function captureForLocateRequest(input: DecideInput): Decision | null {
  if (input.screen?.trim()) return null; // already looked → let the model answer
  const n = normalize(input.transcript);
  const hasScreenTarget = UI_NOUN_PATTERN.test(n) || SCREEN_CONTEXT_PATTERN.test(n);
  const isPointing = POINTING_PATTERN.test(n) && hasScreenTarget;
  const isWhere = WHERE_PATTERN.test(n) && SCREEN_CONTEXT_PATTERN.test(n);
  const isLocate = (isPointing || isWhere) && !CODE_CONTEXT_PATTERN.test(n);
  if (!isLocate) return null;
  // args.locate marks this as a pure locate turn so the orchestrator takes the fast single-vision-call
  // path (ground + point + a short answer) instead of the caption → re-decide flow.
  return {
    narration: 'Let me look at your screen.',
    command: 'capture_screen',
    args: { locate: true },
  };
}

export const __test = { normalize };
