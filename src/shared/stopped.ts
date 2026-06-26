// src/shared/stopped.ts — shared Stop/cancel terminal detection.
//
// Main/executors still report user cancellation as terminal run.failed events ("stopped" before
// executor dispatch, "aborted" after a child receives Stop). Renderers use this helper to keep that
// structural failure from looking like an unexpected product error.

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isStoppedTerminalError(error: string): boolean {
  const clean = compact(error);
  return /\b(stopped|aborted|cancelled|canceled)\b/i.test(clean);
}
