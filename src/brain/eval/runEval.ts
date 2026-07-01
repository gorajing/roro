// src/brain/eval/runEval.ts — the LIVE brain eval runner (opt-in; needs a running Ollama + the model).
//
//   npm run eval:brain                     # score the local brain (qwen2.5:3b)
//
// Scores both halves of the magic moment — DECIDE command-selection and extractFact null-discipline — over
// the golden fixtures, prints a per-case + per-failure-mode report, and writes a checked-in baseline so
// regressions are visible. NOT in CI (it needs a model + is non-deterministic at temperature>0); the pure
// scoring logic IS unit-tested (score.test.ts). The point: turn "is the 3B brain good enough?" into a number.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decide, extractFact, describeBrain } from '../index';
import { DECIDE_CASES, EXTRACT_CASES, BEHAVIORAL_EXTRACT_CASES } from './fixtures';
import { scoreDecision, scoreExtraction, scoreFactValue, summarize, type EvalSummary } from './score';

interface Row {
  id: string;
  expect: string;
  got: string;
  mode: string;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  // EVAL_SET=behavioral runs ONLY the value-quality loop (for the K-repeat before/after measurement of the
  // extraction-value fix) and does NOT overwrite the full baseline.json.
  const onlyBehavioral = process.env.EVAL_SET === 'behavioral';
  console.log(`[eval] brain = ${describeBrain()}`);

  let decideSummary: EvalSummary | undefined;
  let extractSummary: EvalSummary | undefined;

  if (!onlyBehavioral) {
    console.log(`[eval] ${DECIDE_CASES.length} decide + ${EXTRACT_CASES.length} extract + ${BEHAVIORAL_EXTRACT_CASES.length} behavioral cases\n`);

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

    decideSummary = summarize(decideRows.map((r) => r.mode));
    extractSummary = summarize(extractRows.map((r) => r.mode));
    console.log(`\n[eval] DECIDE  ${pct(decideSummary.accuracy)} (${decideSummary.ok}/${decideSummary.total})  ${JSON.stringify(decideSummary.byMode)}`);
    console.log(`[eval] EXTRACT ${pct(extractSummary.accuracy)} (${extractSummary.ok}/${extractSummary.total})  ${JSON.stringify(extractSummary.byMode)}`);
  }

  // BEHAVIORAL — the VALUE-quality axis: is the extracted value a usable recalled-memory line, or noise
  // like "true"? (scoreFactValue, separate from detection.) This is the axis the extraction-value fix moves.
  console.log('\nBEHAVIORAL — is the extracted VALUE descriptive (not a bare boolean)?');
  const behavioralRows: Row[] = [];
  for (const c of BEHAVIORAL_EXTRACT_CASES) {
    let mode: string;
    let got: string;
    try {
      const f = await extractFact(c.input);
      const detect = scoreExtraction(c.expect, f); // detection, for context
      mode = scoreFactValue(c.valueContract, f); // value quality — the metric here
      got = f ? `${f.key}=${JSON.stringify(f.value)} (detect:${detect})` : 'null';
    } catch (e) {
      mode = 'error';
      got = `THREW: ${(e as Error).message.slice(0, 70)}`;
    }
    behavioralRows.push({ id: c.id, expect: 'fact', got, mode });
    console.log(`  ${mode === 'ok' ? '✓' : '✗'} ${c.id.padEnd(20)} got=${got.padEnd(52)} [${mode}]`);
  }
  const behavioralSummary = summarize(behavioralRows.map((r) => r.mode));
  console.log(`\n[eval] BEHAVIORAL value-quality ${pct(behavioralSummary.accuracy)} (${behavioralSummary.ok}/${behavioralSummary.total})  ${JSON.stringify(behavioralSummary.byMode)}`);

  // Baseline = the summaries only (stable, diffable). Non-deterministic at temperature>0, so it's a SNAPSHOT
  // reference for spotting regressions, not a fixture. Only written on a FULL run (not EVAL_SET=behavioral).
  if (!onlyBehavioral && decideSummary && extractSummary) {
    const baseline = { brain: describeBrain(), decide: decideSummary, extract: extractSummary, behavioral: behavioralSummary };
    const out = join(process.cwd(), 'src/brain/eval/baseline.json');
    writeFileSync(out, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\n[eval] wrote ${out}`);
  }
}

main().catch((e) => {
  console.error('[eval] FAILED:', e);
  process.exit(1);
});
