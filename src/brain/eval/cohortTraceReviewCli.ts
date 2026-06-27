import { readFileSync, writeFileSync } from 'node:fs';
import { buildTraceReview, parseTraceJsonl, renderTraceReviewMarkdown } from './cohortTraceReview';

function usage(): string {
  return [
    'Usage: npm run eval:trace-review -- <trace.jsonl> [--out review.md]',
    '',
    'Reads a local RORO_TRACE JSONL file and writes a privacy-preserving cohort review packet.',
    'The output never prints transcripts, recall query text, memory text, or fact values.',
  ].join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  let tracePath = '';
  let outPath = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      return;
    }
    if (arg === '--out') {
      outPath = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (!tracePath) {
      tracePath = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!tracePath) {
    console.error(usage());
    process.exit(1);
  }
  if (outPath === '') {
    outPath = process.env.RORO_TRACE_REVIEW_OUT ?? '';
  }

  const input = readFileSync(tracePath, 'utf8');
  const review = buildTraceReview(parseTraceJsonl(input), tracePath);
  const markdown = renderTraceReviewMarkdown(review);
  if (outPath) {
    writeFileSync(outPath, markdown);
    console.log(`[trace-review] wrote ${outPath}`);
  } else {
    process.stdout.write(markdown);
  }
}

main();
