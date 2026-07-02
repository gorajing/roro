// src/shared/factProposals.ts — the renderer-safe fact-proposal view (executor-facts pilot).
//
// FactProposalView crosses the IPC boundary (main → preload → renderer Memory panel), so it lives in
// shared: importable by all three layers. The pilot's core-only shapes (RunDigest, RawProposal,
// AdmittedProposal, PendingProposal) stay in src/core/orchestrator/factProposals/types.ts.
import type { AgentKind } from './events';

/** Renderer-safe view for the Memory panel's "Roro noticed" section. */
export interface FactProposalView {
  id: string;
  key: string;
  value: string;
  evidence: string;
  agent: AgentKind;
  createdAt: number;
}
