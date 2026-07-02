// src/main/factProposals/runner.ts — fire-and-forget orchestration of one post-run proposal ask.
//
// Called (flag-gated) from dispatchExecutor's terminal branch, exactly like runFactExtraction:
// nothing here may disturb the turn — every failure is caught, traced, and swallowed. ONE proposer
// slot exists globally: a run completing while an ask is in flight SKIPS (never queues asks, never
// contends with the user's next coding turn). cancelAllProposers() is wired next to cancelAllRuns()
// on will-quit so a hung CLI can never outlive the app (the codex-exec hang history, HANDOFF §6).

import { parseProposals, admitProposals } from './admission';
import { createPendingQueue, type PendingQueue } from './pendingQueue';
import type { ProposalSource } from './proposer';
import type { RunDigest } from './types';

const ASK_TIMEOUT_MS = 60_000;

/** The one queue the IPC layer serves — unconfirmed proposals live here and nowhere else. */
export const pendingProposals: PendingQueue = createPendingQueue();

let inFlight: AbortController | null = null;

export interface ProposeTrace {
  stage: 'asked' | 'failed' | 'malformed' | 'queued' | 'skipped_busy';
  runId: string;
  agent: string;
  count?: number;
  keys?: string[];
  reason?: string;
}

export interface ProposeDeps {
  source: ProposalSource;
  queue?: PendingQueue;
  /** Active profile (key,value) pairs, null on failure — dedupe is best-effort by design. */
  getExisting: () => Promise<{ key: string; value: string }[] | null>;
  /** Chip push — invoked only when ≥1 proposal was queued. */
  notify: (count: number) => void;
  trace: (e: ProposeTrace) => void;
  timeoutMs?: number;
}

export async function maybeProposeFacts(digest: RunDigest, deps: ProposeDeps): Promise<void> {
  const queue = deps.queue ?? pendingProposals;
  const base = { runId: digest.runId, agent: digest.agent };
  if (inFlight) {
    deps.trace({ stage: 'skipped_busy', ...base });
    return;
  }
  const controller = new AbortController();
  inFlight = controller;
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? ASK_TIMEOUT_MS);
  try {
    deps.trace({ stage: 'asked', ...base });
    const reply = await deps.source.propose(digest, controller.signal);
    const raw = parseProposals(reply);
    if (raw.length === 0) {
      // [] is the null-discipline SUCCESS path; unparseable garbage also lands here — trace which.
      deps.trace({ stage: 'malformed', ...base, reason: reply.trim().startsWith('[') ? 'empty' : 'unparseable' });
      return;
    }
    const existing = await deps.getExisting().catch(() => null);
    const admitted = admitProposals(raw, { digest, existing });
    if (admitted.length === 0) {
      deps.trace({ stage: 'queued', ...base, count: 0, reason: 'all_rejected_by_admission' });
      return;
    }
    const queued = queue.add(admitted.map((a) => ({
      sessionId: digest.sessionId,
      agent: digest.agent,
      key: a.normalizedKey,
      value: a.value,
      evidence: a.evidence,
    })));
    deps.trace({ stage: 'queued', ...base, count: queued.length, keys: queued.map((q) => q.key) });
    deps.notify(queued.length);
  } catch (err) {
    deps.trace({ stage: 'failed', ...base, reason: (err as Error).message.slice(0, 120) });
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
}

/** Abort any in-flight proposal ask (will-quit path — sibling of cancelAllRuns). */
export function cancelAllProposers(): void {
  inFlight?.abort();
  inFlight = null;
}
