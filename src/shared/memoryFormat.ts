// src/shared/memoryFormat.ts — the DecideInput.memory text format, as a CROSS-SUBSYSTEM contract.
//
// The memory string is COMPOSED in src/main/memoryContext.ts and STRUCTURALLY INSPECTED in
// src/brain/clarifyGate.ts (the gate stands down when episodic context exists). Those two lived in
// different subsystems coupled by a literal string — renaming the header in the composer would have
// silently re-enabled clarify prompts in the brain. One constant per section header makes the
// coupling a compile-time import instead of a prayer.

export const MEMORY_FACTS_HEADER = 'KNOWN ABOUT THIS USER:';
export const MEMORY_EPISODES_HEADER = 'RELATED PAST CONTEXT:';
