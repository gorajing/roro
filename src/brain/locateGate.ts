import type { Decision, DecideInput } from '../shared/brain';

// Deterministic routing for the paw-on-the-pixel wedge: a request to POINT AT / LOCATE / SHOW WHERE
// something is on the user's screen requires SEEING the screen, so it must route to capture_screen — but
// a local 3B decider is unreliable at inferring that (it often answers "I'll look at your screen" while
// emitting `answer`). This gate forces capture_screen for clear on-screen locate intents, exactly like
// clarifyGate forces clarify for referent-less requests. Once the screen HAS been captured (input.screen
// set), the gate stands down so the second decide() produces the real answer (no infinite capture loop).

const LOCATE_PATTERNS: RegExp[] = [
  /\bpoint (at|to)\b/,
  /\bshow me where\b/,
  /\b(at|on|in) (the|my) (screen|display)\b/, // "look at my screen", "on the screen"
  /\bwhere (is|are|s) .+\b(button|icon|menu|tab|field|link|option|setting|toggle|control|logo|bar|panel)\b/,
];

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
  const normalized = normalize(input.transcript);
  if (!LOCATE_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  // args.locate marks this as a pure locate turn so the orchestrator takes the fast single-vision-call
  // path (ground + point + a short answer) instead of the caption → re-decide flow.
  return {
    narration: 'Let me look at your screen.',
    command: 'capture_screen',
    args: { locate: true },
  };
}

export const __test = { normalize };
