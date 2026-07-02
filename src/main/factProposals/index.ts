// src/main/factProposals — executor-assisted fact extraction (flag-gated pilot).
// Spec: docs/plans/executor-facts-pilot.md. Deletable in one commit.
export type { RunDigest, RawProposal, AdmittedProposal, PendingProposal, FactProposalView } from './types';
export { DIGEST_CAPS } from './types';
export { buildProposalPrompt } from './prompt';
export { parseProposals, admitProposals, MAX_ADMITTED_PER_RUN } from './admission';
export { createPendingQueue, type PendingQueue } from './pendingQueue';
export { executorProposalSource, type ProposalSource } from './proposer';
export { maybeProposeFacts, cancelAllProposers, pendingProposals, type ProposeDeps, type ProposeTrace } from './runner';
