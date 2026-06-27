# Cohort Trace to Eval

Roro's Phase 3 cohort should teach the eval suite without weakening tester privacy. `RORO_TRACE` is the local
diagnostic substrate, but the default trace deliberately does not contain transcripts, memory result text, fact values,
or narration. Treat it as the map of what happened, not as text to paste into fixtures.

## Capture

Use one local trace file per tester/session, outside the repo:

```sh
mkdir -p /tmp/roro-cohort
RORO_TRACE=1 \
RORO_TRACE_FILE=/tmp/roro-cohort/tester-01-first-turn.roro-trace.jsonl \
npm start
```

Default trace mode hashes recall queries. Do not use `RORO_TRACE_QUERY=plaintext` for cohort runs unless the tester
explicitly opts in and the file stays local. Never commit raw trace files or raw observer notes.

## Review Packet

Generate a privacy-preserving review packet:

```sh
npm run eval:trace-review -- /tmp/roro-cohort/tester-01-first-turn.roro-trace.jsonl --out /tmp/roro-cohort/tester-01.roro-trace-review.md
```

The report prints counts, extraction stages, fact keys, and recall candidate counts. It does not print transcripts,
queries, memory text, or fact values. Use it beside human observer notes to decide whether a redacted fixture is worth
adding.

If you write reports inside the repo by accident, `*.roro-trace-review.md`, `*.roro-trace.jsonl`,
`roro-cohort/`, and the default `.roro-memory2/` runtime store are ignored. Prefer `/tmp/roro-cohort` anyway.

## Fixture Rules

Add a fixture only when the trace plus observer note identifies a durable product gap:

- `DECIDE_CASES`: the tester wording should have produced `clarify`, `capture_screen`, `answer`, or `run_agent`, and
  the current brain chose the wrong command.
- `EXTRACT_CASES`: a stated durable preference should have produced a fact, or a one-off task/chitchat produced a
  false fact.
- `BEHAVIORAL_EXTRACT_CASES`: the extractor found a behavioral preference but the value was too thin, off-topic, or
  would not be useful when recalled.

Before committing, paraphrase away names, repo paths, secrets, customer data, and distinctive project language. The
committed fixture should preserve the failure mechanism, not the tester's private wording.

Do not auto-label from Roro's observed model output. The expectation is a human contract label, and ambiguous cases stay
in the local review packet until a future cohort repeats the pattern.

## Verification

After adding redacted fixtures:

```sh
npx vitest run --no-file-parallelism src/brain/eval/fixtures.test.ts src/brain/eval/cohortTraceReview.test.ts
npm run eval:brain
```

`fixtures.test.ts` enforces fixture hygiene and anti-memorization constraints. `npm run eval:brain` is the live Ollama
scorecard; review its diff to decide whether the new fixture exposes a regression, an expected model limit, or a product
prompt/guard issue.
