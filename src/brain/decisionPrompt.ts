// src/brain/decisionPrompt.ts — the DECIDE prompt assembly.
//
// Extracted here as a PURE, dependency-light module (only a type import) so two callers share ONE source
// of truth: `brain/index.ts` (which sends it to the model) and the orchestrator's opt-in evidence capture
// (which reconstructs the byte-exact prompt to prove "memory steered the work" — see captureDecide). The
// orchestrator lazy-loads the heavy brain, so it must NOT import `brain/index.ts` eagerly; importing this
// pure module is free.

import type { DecideInput } from '../shared/brain';

export function buildDecisionPrompt(input: DecideInput): string {
  return [
    input.memory ? `RELEVANT MEMORY:\n${input.memory}` : '',
    input.screen ? `CURRENT SCREEN:\n${input.screen}` : '',
    `USER SAID: ${JSON.stringify(input.transcript)}`,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
}
