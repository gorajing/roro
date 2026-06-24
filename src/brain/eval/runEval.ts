// src/brain/eval/runEval.ts — the LIVE brain eval runner (opt-in; needs a running Ollama + the model).
//
//   npm run eval:brain                     # score the default local brain (qwen2.5:3b)
//   BRAIN_PROVIDER=nebius npm run eval:brain   # score the cloud ceiling (DeepSeek) for reference
//
// Scores both halves of the magic moment — DECIDE command-selection and extractFact null-discipline — over
// the golden fixtures, prints a per-case + per-failure-mode report, and writes a checked-in baseline so
// regressions are visible. NOT in CI (it needs a model + is non-deterministic at temperature>0); the pure
// scoring logic IS unit-tested (score.test.ts). The point: turn "is the 3B brain good enough?" into a number.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decide, extractFact, describeBrain } from '../index';
import { DECIDE_CASES, EXTRACT_CASES } from './fixtures';
import { scoreDecision, scoreExtraction, summarize } from './score';

interface Row {
  id: string;
  expect: string;
  got: string;
  mode: string;
}

async function main(): Promise<void> {
  console.log(`[eval] brain = ${describeBrain()}`);
  console.log(`[eval] ${DECIDE_CASES.length} decide cases + ${EXTRACT_CASES.length} extract cases\n`);

  console.log('DECIDE — does the brain pick the right command?');
  const decideRows: Row[] = [];
  for (const c of DECIDE_CASES) {
    let mode: string;
    let got: string;
    try {
      const d = await decide(c.input);
      mode = scoreDecision(c.expect, d.command);
      got = d.command;
    } catch (e) {
      mode = 'bad_json'; // a decide() throw = unparseable/invalid decision (assumes Ollama is reachable)
      got = `THREW: ${(e as Error).message.slice(0, 70)}`;
    }
    decideRows.push({ id: c.id, expect: c.expect, got, mode });
    console.log(`  ${mode === 'ok' ? '✓' : '✗'} ${c.id.padEnd(16)} want=${c.expect.padEnd(14)} got=${got}`);
  }

  console.log('\nEXTRACT — durable fact when expected, null-discipline otherwise?');
  const extractRows: Row[] = [];
  for (const c of EXTRACT_CASES) {
    let mode: string;
    let got: string;
    try {
      const f = await extractFact(c.input);
      mode = scoreExtraction(c.expect, f);
      got = f ? `fact(${f.key})` : 'null';
    } catch (e) {
      mode = 'error';
      got = `THREW: ${(e as Error).message.slice(0, 70)}`;
    }
    extractRows.push({ id: c.id, expect: c.expect, got, mode });
    console.log(`  ${mode === 'ok' ? '✓' : '✗'} ${c.id.padEnd(16)} want=${c.expect.padEnd(6)} got=${got.padEnd(24)} [${mode}]`);
  }

  const decideSummary = summarize(decideRows.map((r) => r.mode));
  const extractSummary = summarize(extractRows.map((r) => r.mode));

  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  console.log(`\n[eval] DECIDE  ${pct(decideSummary.accuracy)} (${decideSummary.ok}/${decideSummary.total})  ${JSON.stringify(decideSummary.byMode)}`);
  console.log(`[eval] EXTRACT ${pct(extractSummary.accuracy)} (${extractSummary.ok}/${extractSummary.total})  ${JSON.stringify(extractSummary.byMode)}`);

  // Baseline = the summaries only (stable, diffable). The model is non-deterministic at temperature>0, so
  // this is a SNAPSHOT reference point for spotting regressions, not a deterministic fixture.
  const baseline = { brain: describeBrain(), decide: decideSummary, extract: extractSummary };
  const out = join(process.cwd(), 'src/brain/eval/baseline.json');
  writeFileSync(out, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\n[eval] wrote ${out}`);
}

main().catch((e) => {
  console.error('[eval] FAILED:', e);
  process.exit(1);
});
