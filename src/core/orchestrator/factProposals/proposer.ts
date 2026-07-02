// src/main/factProposals/proposer.ts — the ProposalSource seam + its executor-backed implementation.
//
// Reuses the EXISTING executor adapters (getExecutor().run()) rather than a bespoke spawn path, so
// every hard-won invariant — stdin=/dev/null, JSONL tolerance, exitAccounting, SIGKILL escalation,
// PATH reconstruction — is inherited, not re-derived. The ask runs READ-ONLY (codex `-s read-only`;
// claude plan-mode/Read-only tools — pinned by execArgs.test.ts) with cwd pointed at a scratch temp
// dir: the digest is fully in-prompt, so the ask needs zero repo access (point-don't-act).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getExecutor } from '../../executor';
import { buildProposalPrompt } from './prompt';
import type { RunDigest } from './types';

export interface ProposalSource {
  /** Ask the model what this run taught about the user; resolves to its raw textual reply. */
  propose(digest: RunDigest, signal: AbortSignal): Promise<string>;
}

export function executorProposalSource(getExec: typeof getExecutor = getExecutor): ProposalSource {
  return {
    async propose(digest, signal) {
      const scratch = await mkdtemp(join(tmpdir(), 'roro-reflect-'));
      try {
        let finalText: string | undefined;
        let lastMessage: string | undefined;
        const executor = getExec(digest.agent);
        for await (const ev of executor.run({
          repo: scratch,
          prompt: buildProposalPrompt(digest),
          agent: digest.agent,
          signal,
          readOnly: true,
        })) {
          if (ev.kind === 'message') lastMessage = ev.text;
          else if (ev.kind === 'run.completed') finalText = ev.finalText ?? lastMessage;
          else if (ev.kind === 'run.failed') throw new Error(`proposal ask failed: ${ev.error}`);
        }
        const reply = finalText ?? lastMessage;
        if (reply === undefined) throw new Error('proposal ask yielded no output');
        return reply;
      } finally {
        void rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
