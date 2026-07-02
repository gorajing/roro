// src/brain/eval/runProposalEval.ts — the LIVE executor-proposal eval (docs/plans/executor-facts-pilot.md §7).
//
//   npm run eval:proposals                       # ask the codex CLI (default)
//   npm run eval:proposals -- --agent claude     # ask the claude CLI
//   npm run eval:proposals -- --write-baseline   # additionally update proposalBaseline.json
//
// OPT-IN AND EXPENSIVE: every case spawns the REAL executor CLI (read-only, scratch cwd) and burns the
// user's provider quota — this must NEVER be wired into CI. The pure half (parse+admit over the fixture
// digests) IS in CI (proposalFixtures.test.ts): protect production deterministically there, measure the
// model here — the split the eval-metric-DOA lesson demands (LESSONS.md).
//
// Two live tiers:
//  1. APPLES-TO-APPLES — each behavioral fixture wrapped as a DEGENERATE RunDigest (task = the
//     transcript; empty commands/files/messages) through the production pipeline
//     buildProposalPrompt -> executorProposalSource -> parseProposals -> admitProposals, scored on the
//     SAME scoreFactValue axis as the 3B eval, so the number lands directly beside baseline.json's
//     `behavioral` (the 40%). Null-expecting cases score null-discipline (admission must end with []) —
//     EXCEPT taxonomy 'marker-less': the 17-marker gate is a 3B-channel artifact; the executor channel
//     has no such gate and extracting those preferences would be a WIN, so they are excluded here.
//  2. DETERMINISTIC DIGESTS — the two real-shaped fixture digests (replayed executor streams). A routine
//     scripted hello.py run teaches nothing durable about the person, so the golden outcome is [].
//
// Channel axes: proposals-per-run and grounding-rejection rate (computed with admission's OWN
// isGroundedInDigest, never a re-derived copy). Every run writes proposalLatest.json (untracked
// scratch); the checked-in proposalBaseline.json only updates with an explicit --write-baseline —
// the same lucky-run discipline as runEval.ts.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BEHAVIORAL_EXTRACT_CASES, type BehavioralCase } from './fixtures';
import { scoreExtraction, scoreFactValue, summarize, type EvalSummary } from './score';
import { codexFixtureDigest, claudeFixtureDigest } from './proposalFixtures';
import { executorProposalSource } from '../../main/factProposals/proposer';
import { parseProposals, admitProposals, isGroundedInDigest } from '../../main/factProposals/admission';
import type { RunDigest, RawProposal, AdmittedProposal } from '../../main/factProposals/types';
import type { AgentKind } from '../../shared/events';

const ASK_TIMEOUT_MS = 120_000; // a cold CLI spawn + a frontier reply; SIGKILL escalation is inherited

interface Row {
  id: string;
  taxonomy: string;
  mode: string;
  got: string;
  parsed: number;
  admitted: number;
  ungrounded: number;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

function degenerateDigest(c: BehavioralCase, agent: AgentKind): RunDigest {
  // Task = the transcript and NOTHING else — the same information the 3B extractor gets, so the two
  // channels' numbers are comparable. (Production digests carry commands/files/messages; the
  // deterministic tier covers that shape.)
  return {
    runId: `eval_${c.id}`,
    sessionId: 'proposal-eval',
    repo: '(eval)',
    agent,
    task: c.input.transcript,
    outcome: 'completed',
    commands: [],
    files: [],
    messages: [],
  };
}

async function askOnce(
  digest: RunDigest,
  source: ReturnType<typeof executorProposalSource>,
): Promise<{ raw: RawProposal[]; admitted: AdmittedProposal[]; ungrounded: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  try {
    const reply = await source.propose(digest, controller.signal);
    const raw = parseProposals(reply);
    const admitted = admitProposals(raw, { digest, existing: [] }); // no profile in eval-land: dedupe off
    const ungrounded = raw.filter((p) => !isGroundedInDigest(p.evidence, digest)).length;
    return { raw, admitted, ungrounded };
  } finally {
    clearTimeout(timer);
  }
}

const fmtAdmitted = (admitted: AdmittedProposal[]): string =>
  admitted.length === 0 ? '[]' : admitted.map((a) => `${a.normalizedKey}=${JSON.stringify(a.value)}`).join(', ');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const agentArg = argv[argv.indexOf('--agent') + 1];
  const agent: AgentKind = argv.includes('--agent') && agentArg === 'claude' ? 'claude' : 'codex';
  const source = executorProposalSource();

  const factCases = BEHAVIORAL_EXTRACT_CASES.filter((c) => c.expect === 'fact');
  const nullCases = BEHAVIORAL_EXTRACT_CASES.filter((c) => c.expect === 'null' && c.taxonomy !== 'marker-less');
  console.log(`[eval:proposals] channel = ${agent} executor CLI (live asks — burns quota; NOT CI)`);
  console.log(`[eval:proposals] ${factCases.length} value-quality + ${nullCases.length} null-discipline degenerate cases + 2 fixture digests\n`);

  const rows: Row[] = [];
  const run = async (c: BehavioralCase, score: (admitted: AdmittedProposal[]) => string): Promise<void> => {
    let row: Row;
    try {
      const { raw, admitted, ungrounded } = await askOnce(degenerateDigest(c, agent), source);
      row = { id: c.id, taxonomy: c.taxonomy, mode: score(admitted), got: fmtAdmitted(admitted), parsed: raw.length, admitted: admitted.length, ungrounded };
    } catch (e) {
      row = { id: c.id, taxonomy: c.taxonomy, mode: 'error', got: `THREW: ${(e as Error).message.slice(0, 70)}`, parsed: 0, admitted: 0, ungrounded: 0 };
    }
    rows.push(row);
    console.log(`  ${row.mode === 'ok' ? '✓' : '✗'} ${row.id.padEnd(24)} [${row.taxonomy.padEnd(16)}] got=${row.got.padEnd(56)} [${row.mode}]`);
  };

  console.log('VALUE-QUALITY — does the executor channel produce a usable descriptive value? (vs the 3B 40%)');
  const valueRowStart = rows.length;
  for (const c of factCases) {
    await run(c, (admitted) =>
      scoreFactValue(c.valueContract, admitted.length > 0 ? { key: admitted[0].normalizedKey, value: admitted[0].value } : null));
  }
  const valueRows = rows.slice(valueRowStart);

  console.log('\nNULL-DISCIPLINE — silence on marker-bearing negatives (post-admission)?');
  const nullRowStart = rows.length;
  for (const c of nullCases) {
    await run(c, (admitted) =>
      scoreExtraction('null', admitted.length > 0 ? { key: admitted[0].normalizedKey, value: admitted[0].value } : null));
  }
  const nullRows = rows.slice(nullRowStart);

  console.log('\nDIGEST TIER — the two real-shaped fixture digests (routine runs: golden outcome is [])');
  const digestRowStart = rows.length;
  for (const digest of [codexFixtureDigest(), claudeFixtureDigest()]) {
    let row: Row;
    try {
      // { ...digest, agent } so --agent picks which CLI answers; the digest CONTENT stays the fixture's.
      const { raw, admitted, ungrounded } = await askOnce({ ...digest, agent }, source);
      const mode = scoreExtraction('null', admitted.length > 0 ? { key: admitted[0].normalizedKey, value: admitted[0].value } : null);
      row = { id: digest.runId, taxonomy: 'digest-fixture', mode, got: fmtAdmitted(admitted), parsed: raw.length, admitted: admitted.length, ungrounded };
    } catch (e) {
      row = { id: digest.runId, taxonomy: 'digest-fixture', mode: 'error', got: `THREW: ${(e as Error).message.slice(0, 70)}`, parsed: 0, admitted: 0, ungrounded: 0 };
    }
    rows.push(row);
    console.log(`  ${row.mode === 'ok' ? '✓' : '✗'} ${row.id.padEnd(32)} got=${row.got.padEnd(48)} [${row.mode}]`);
  }
  const digestRows = rows.slice(digestRowStart);

  const valueQuality = summarize(valueRows.map((r) => r.mode));
  const nullDiscipline = summarize(nullRows.map((r) => r.mode));
  const digestTier = summarize(digestRows.map((r) => r.mode));
  const byTaxonomy: Record<string, EvalSummary> = {};
  for (const t of new Set(rows.map((r) => r.taxonomy))) {
    byTaxonomy[t] = summarize(rows.filter((r) => r.taxonomy === t).map((r) => r.mode));
  }
  const asks = rows.length;
  const parsed = rows.reduce((n, r) => n + r.parsed, 0);
  const admitted = rows.reduce((n, r) => n + r.admitted, 0);
  const ungrounded = rows.reduce((n, r) => n + r.ungrounded, 0);
  const axes = {
    asks,
    proposalsParsed: parsed,
    proposalsAdmitted: admitted,
    proposalsPerRun: asks === 0 ? 0 : parsed / asks,
    // Of everything the model proposed, how much failed the verbatim-evidence receipt? (Other
    // admission drops — boolean values, secret shapes, caps — are NOT counted here.)
    groundingRejectionRate: parsed === 0 ? 0 : ungrounded / parsed,
  };

  console.log(`\n[eval:proposals] VALUE-QUALITY   ${pct(valueQuality.accuracy)} (${valueQuality.ok}/${valueQuality.total})  ${JSON.stringify(valueQuality.byMode)}`);
  try {
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'src/brain/eval/baseline.json'), 'utf8')) as { behavioral?: EvalSummary };
    if (baseline.behavioral) {
      console.log(`[eval:proposals]   vs 3B baseline behavioral value-quality: ${pct(baseline.behavioral.accuracy)} (${baseline.behavioral.ok}/${baseline.behavioral.total})`);
    }
  } catch {
    // no baseline.json to compare against — the number above still stands alone
  }
  console.log(`[eval:proposals] NULL-DISCIPLINE ${pct(nullDiscipline.accuracy)} (${nullDiscipline.ok}/${nullDiscipline.total})  ${JSON.stringify(nullDiscipline.byMode)}`);
  console.log(`[eval:proposals] DIGEST TIER     ${pct(digestTier.accuracy)} (${digestTier.ok}/${digestTier.total})  ${JSON.stringify(digestTier.byMode)}`);
  console.log(`[eval:proposals] axes: ${JSON.stringify(axes)}`);

  const results = { channel: `${agent} executor CLI`, valueQuality, nullDiscipline, digestTier, byTaxonomy, axes };
  const latest = join(process.cwd(), 'src/brain/eval/proposalLatest.json');
  writeFileSync(latest, JSON.stringify(results, null, 2) + '\n');
  console.log(`\n[eval:proposals] wrote ${latest}`);
  if (process.argv.includes('--write-baseline')) {
    const out = join(process.cwd(), 'src/brain/eval/proposalBaseline.json');
    writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
    console.log(`[eval:proposals] BASELINE UPDATED: ${out} (explicit --write-baseline)`);
  } else {
    console.log('[eval:proposals] proposalBaseline.json untouched — pass --write-baseline to update the reference');
  }
}

main().catch((e) => {
  console.error('[eval:proposals] FAILED:', e);
  process.exit(1);
});
