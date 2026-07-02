// src/ambient/belief.ts — the restraint gate for the (gated, OFF-BY-DEFAULT) ambient eye.
//
// Edge-trigger, not level-trigger: the ambient watcher should react to a CHANGE in what it sees,
// never to the continued PRESENCE of the same thing — the "quiet 99% of the time" rule that keeps a
// proactive companion from nagging. This module decides "is this a NEW thing worth a turn?" with a
// stable signature, BEFORE any expensive work.
//
// Pure + deterministic: no screen capture, no model, no timers, no Date.now() — it unit-tests. It is
// DORMANT until the ambient-turn seam wires it; importing or running it enables no watching and
// touches no frozen contract. The ambient eye itself remains cut from v0 (PUBLIC.md) and gated.

/** Coarse class of one ambient read. `idle`/`unknown` are non-events (never worth a turn). */
export type AmbientKind = 'idle' | 'change' | 'risk' | 'unknown';

/** One read from the ambient eye. The eye refines these later; the gate only needs kind + a subject. */
export interface AmbientObservation {
  kind: AmbientKind;
  /** The app/surface in focus (e.g. 'terminal', 'editor'); optional. */
  app?: string;
  /** A short description of what was seen/changed; the signature is built from its stable words. */
  what?: string;
}

/** Does this read even warrant consideration? (idle/unknown never do.) */
export const isEventful = (o: AmbientObservation): boolean => o.kind === 'change' || o.kind === 'risk';

/** A stable identity for an observation. Coarse on purpose: kind + app + its stable words, so two
 *  reads of the SAME thing hash equal (reordered/reworded with the same key words collapses), while a
 *  real change flips it. Uses ALL stable words (not a truncated subset) so distinct subjects that share
 *  some words never collide and silently suppress a real new event. */
export function observationSignature(o: AmbientObservation): string {
  const subject = (o.what ?? '')
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*(s|ms|%)?/g, ' ') // drop volatile numbers / durations / counts
    .replace(/[^a-z/_. -]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .sort() // order-independent: a reordered description with the same key words hashes the same
    .join('-');
  return `${o.kind}|${(o.app ?? '').toLowerCase()}|${subject}`;
}

/** The latch decision: act only on a genuinely NEW event — eventful AND a different signature from the
 *  last one acted on. Same signature ⇒ already acknowledged; stay quiet. */
export const isNewObservation = (o: AmbientObservation, lastSignature: string | null): boolean =>
  isEventful(o) && observationSignature(o) !== lastSignature;
