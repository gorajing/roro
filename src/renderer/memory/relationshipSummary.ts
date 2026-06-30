// src/renderer/memory/relationshipSummary.ts — a renderer-only, READ-ONLY "being-known" line for the
// "What Roro remembers" panel, derived from how many facts Roro currently holds about you. No new
// persisted state, no IPC, no schema change, and it deliberately does NOT reintroduce the cut
// bond/greeting tier. Pure (no DOM) so it unit-tests.
//
// Deliberately a plain COUNT, not a "you've confirmed" claim: a fact's confidence also rises when the
// brain re-extracts it in a later turn (reinforceFact), not only when the user presses "Looks right",
// so a confidence-based "confirmed" count would overstate explicit user confirmation in the trust panel.

/** One human line for the panel header. Empty string when there's nothing to say yet. */
export function formatRelationshipCount(known: number): string {
  if (known <= 0) return '';
  const things = known === 1 ? '1 thing' : `${known} things`;
  return `Roro remembers ${things} about you.`;
}
