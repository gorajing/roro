// src/brain/eval/proposalFixtures.ts — the proposal eval's DETERMINISTIC tier: two real-shaped
// RunDigests built by replaying the executor fixtures (the captured codex v0.139.0 JSONL + the
// documented claude 2.1.x sample) through the SAME mappers and digest accumulator production uses.
// Nothing here talks to a model: the digests are pure functions of checked-in fixture bytes, so the
// CI test (proposalFixtures.test.ts) can pin the parse+admit half (protect production) while the
// live runner (runProposalEval.ts) asks the real executor about the same digests (measure the model).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapCodexThreadEvent,
  mapClaudeMessage,
  mapClaudeMessageBlocks,
  mapClaudeStreamEvent,
  newClaudeCorrelation,
} from '../../executor';
import { CLAUDE_STREAM_SAMPLE } from '../../executor/__fixtures__/claudeSample';
import { createDigestAccumulator } from '../../orchestrator/factProposals/digest';
import type { RunDigest } from '../../orchestrator/factProposals/types';
import type { ActionEvent } from '../../../shared/events';

// The dispatched tasks are fixture METADATA (the streams don't carry them): plausible prompts for the
// hello.py runs the fixtures captured. Deliberately mundane — a scripted one-file task should teach the
// proposer nothing durable about the person, which is exactly what the live tier scores ([] expected).
const CODEX_FIXTURE_TASK = 'create hello.py that prints hi, then run it to verify the output';
const CLAUDE_FIXTURE_TASK = 'make a hello.py script and check it works';

/** Replay the captured codex JSONL through mapCodexThreadEvent into a digest accumulator. */
export function codexFixtureDigest(): RunDigest {
  const lines = readFileSync(join(__dirname, '../../executor/__fixtures__/codex_hello.jsonl'), 'utf8').split('\n');
  const acc = createDigestAccumulator();
  let finalText: string | undefined;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    const ev = mapCodexThreadEvent(JSON.parse(s), 'run_proposal_fixture_codex');
    if (!ev) continue;
    acc.see(ev);
    if (ev.kind === 'run.completed') finalText = ev.finalText; // codex emits none — stays undefined, like production
  }
  return acc.finish({
    runId: 'run_proposal_fixture_codex',
    sessionId: 'proposal-eval',
    repo: '/tmp/companion_scratch',
    agent: 'codex',
    task: CODEX_FIXTURE_TASK,
    finalText,
  });
}

/** Replay the documented claude stream-json sample through the claude mappers (the same driving loop
 *  as src/executor/fixtures.test.ts) into a digest accumulator. */
export function claudeFixtureDigest(): RunDigest {
  const acc = createDigestAccumulator();
  const corr = newClaudeCorrelation();
  let emittedStart = false;
  let finalText: string | undefined;
  const see = (ev: ActionEvent | null): void => {
    if (!ev) return;
    acc.see(ev);
    if (ev.kind === 'run.completed') finalText = ev.finalText;
  };
  for (const obj of CLAUDE_STREAM_SAMPLE) {
    const delta = mapClaudeStreamEvent(obj, 'run_proposal_fixture_claude');
    if (delta) {
      see(delta);
      continue;
    }
    const o = obj as Record<string, unknown>;
    if (!emittedStart && o.type === 'system' && o.subtype === 'init') {
      const started = mapClaudeMessage(obj, 'run_proposal_fixture_claude', corr);
      if (started) {
        emittedStart = true;
        see(started);
        see({ kind: 'turn.started', runId: 'run_proposal_fixture_claude', ts: 0 });
      }
      continue;
    }
    if (o.type === 'assistant' || o.type === 'user') {
      for (const ev of mapClaudeMessageBlocks(obj, 'run_proposal_fixture_claude', corr)) see(ev);
      continue;
    }
    see(mapClaudeMessage(obj, 'run_proposal_fixture_claude', corr));
  }
  return acc.finish({
    runId: 'run_proposal_fixture_claude',
    sessionId: 'proposal-eval',
    repo: '/tmp/x',
    agent: 'claude',
    task: CLAUDE_FIXTURE_TASK,
    finalText,
  });
}
