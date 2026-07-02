// src/main/factProposals/types.ts — the executor-assisted fact-extraction pilot's data shapes.
// Spec of record: docs/plans/executor-facts-pilot.md. Flag-gated by RORO_EXECUTOR_FACTS; deletable
// in one commit.

import type { AgentKind } from '../../../shared/events';

/**
 * The bounded post-run digest the proposal ask consumes. PRIVACY INVARIANT BY CONSTRUCTION: it
 * carries ONLY material the executor's provider already received in this run — the dispatched task,
 * the executor's own emitted events, and its terminal text. NEVER the raw transcript, the 3B
 * narration, recalled memory, or profile facts (prompt.test.ts pins this by building the prompt
 * from a RunDigest literal alone).
 */
export interface RunDigest {
  runId: string;
  sessionId: string;
  repo: string;
  agent: AgentKind;
  /** The exact prompt the executor was given (decision.args.task ?? transcript — provider-visible). */
  task: string;
  /** The proposer only ever fires on completed runs (a failed run teaches about the repo, not the user). */
  outcome: 'completed';
  finalText?: string;
  commands: string[];
  files: { path: string; op: 'add' | 'update' | 'delete' }[];
  messages: string[];
}

/** Accumulation caps, enforced at digest-build time in the orchestrator's event loop. */
export const DIGEST_CAPS = { commands: 30, commandChars: 200, files: 50, messages: 10, messageChars: 500 } as const;

/** One parsed proposal from the executor's reply — pre-admission, untrusted. */
export interface RawProposal {
  key: string;
  value: string;
  /** A verbatim quote from the digest — the grounding receipt admission verifies. */
  evidence: string;
}

/** A proposal that survived the deterministic admission gate — showable, still NOT storable. */
export interface AdmittedProposal extends RawProposal {
  normalizedKey: string;
}

/** A queued proposal awaiting the user's confirm/reject. Lives only in MAIN memory (never in memory2). */
export interface PendingProposal {
  id: string;
  sessionId: string;
  agent: AgentKind;
  key: string; // normalized
  value: string;
  evidence: string;
  createdAt: number;
}

// FactProposalView (the renderer-safe view) lives in src/shared/factProposals.ts — it crosses the IPC
// boundary, so the renderer imports it from shared, not from the core.
