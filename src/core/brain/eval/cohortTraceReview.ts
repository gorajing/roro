export interface TraceReviewEvent {
  kind: string;
  ts?: string;
  [key: string]: unknown;
}

export interface ExtractTraceObservation {
  ts: string;
  sessionId: string;
  outcome: string;
  stage: string;
  reason: string;
  factKey: string;
}

export interface RecallTraceObservation {
  ts: string;
  queryMode: 'hashed' | 'plaintext' | 'missing';
  candidateCount: number;
  returnedCount: number;
}

export interface TraceReview {
  source: string;
  eventCount: number;
  byKind: Record<string, number>;
  extractByStage: Record<string, number>;
  extracts: ExtractTraceObservation[];
  recalls: RecallTraceObservation[];
  plaintextRecallQueries: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim() || '-';
}

function queryMode(query: unknown): RecallTraceObservation['queryMode'] {
  if (typeof query !== 'string' || !query) return 'missing';
  return /^[0-9a-f]{16}$/i.test(query) ? 'hashed' : 'plaintext';
}

export function parseTraceJsonl(input: string): TraceReviewEvent[] {
  const events: TraceReviewEvent[] = [];
  const lines = input.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid trace JSON on line ${index + 1}: ${message}`);
    }
    const record = asRecord(parsed);
    if (!record || typeof record.kind !== 'string') {
      throw new Error(`Invalid trace event on line ${index + 1}: expected an object with string kind`);
    }
    events.push(record as TraceReviewEvent);
  }
  return events;
}

export function buildTraceReview(events: TraceReviewEvent[], source = 'trace.jsonl'): TraceReview {
  const byKind: Record<string, number> = {};
  const extractByStage: Record<string, number> = {};
  const extracts: ExtractTraceObservation[] = [];
  const recalls: RecallTraceObservation[] = [];
  let plaintextRecallQueries = 0;

  for (const event of events) {
    count(byKind, event.kind);

    if (event.kind === 'extract') {
      const stage = asString(event.stage, 'unknown');
      count(extractByStage, stage);
      extracts.push({
        ts: asString(event.ts, '-'),
        sessionId: asString(event.sessionId, '-'),
        outcome: asString(event.outcome, '-'),
        stage,
        reason: asString(event.reason, ''),
        factKey: asString(event.factKey, ''),
      });
    }

    if (event.kind === 'recall') {
      const candidates = Array.isArray(event.candidates) ? event.candidates : [];
      const mode = queryMode(event.query);
      if (mode === 'plaintext') plaintextRecallQueries += 1;
      recalls.push({
        ts: asString(event.ts, '-'),
        queryMode: mode,
        candidateCount: candidates.length,
        returnedCount: candidates.filter((candidate) => asRecord(candidate)?.returned === true).length,
      });
    }
  }

  return {
    source,
    eventCount: events.length,
    byKind,
    extractByStage,
    extracts,
    recalls,
    plaintextRecallQueries,
  };
}

export function renderTraceReviewMarkdown(review: TraceReview): string {
  const lines: string[] = [];
  lines.push('# Roro Cohort Trace Review');
  lines.push('');
  lines.push(`Source: ${review.source}`);
  lines.push(`Events: ${review.eventCount}`);
  lines.push('');
  lines.push('## Privacy Contract');
  lines.push('');
  lines.push('- This report does not print recall query text, memory result text, transcripts, narration, or fact values.');
  lines.push('- Raw trace files and raw observer notes stay local and must not be committed.');
  lines.push('- Commit only manually redacted, generalized fixtures added to `src/brain/eval/fixtures.ts`.');
  if (review.plaintextRecallQueries > 0) {
    lines.push(`- Warning: ${review.plaintextRecallQueries} recall event(s) used plaintext query mode; redact from observer notes before fixture work.`);
  }
  lines.push('');

  lines.push('## Event Counts');
  lines.push('');
  lines.push('| kind | count |');
  lines.push('| --- | ---: |');
  for (const [kind, value] of Object.entries(review.byKind).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${markdownCell(kind)} | ${value} |`);
  }
  if (Object.keys(review.byKind).length === 0) lines.push('| - | 0 |');
  lines.push('');

  lines.push('## Extraction Outcomes');
  lines.push('');
  lines.push('| stage | count |');
  lines.push('| --- | ---: |');
  for (const [stage, value] of Object.entries(review.extractByStage).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${markdownCell(stage)} | ${value} |`);
  }
  if (Object.keys(review.extractByStage).length === 0) lines.push('| - | 0 |');
  lines.push('');

  lines.push('## Per-Turn Review Queue');
  lines.push('');
  lines.push('| session | outcome | extraction | reason / fact key | fixture action |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of review.extracts) {
    const detail = reviewDetail(item);
    lines.push(
      `| ${markdownCell(item.sessionId)} | ${markdownCell(item.outcome)} | ${markdownCell(item.stage)} | ${markdownCell(detail)} | ${fixtureAction(item)} |`,
    );
  }
  if (review.extracts.length === 0) lines.push('| - | - | - | - | No extract events. Check whether the trace covers complete turns. |');
  lines.push('');

  lines.push('## Recall Diagnostics');
  lines.push('');
  lines.push('| query mode | candidate count | returned count |');
  lines.push('| --- | ---: | ---: |');
  for (const item of review.recalls) {
    lines.push(`| ${item.queryMode === 'plaintext' ? 'plaintext (not printed)' : item.queryMode} | ${item.candidateCount} | ${item.returnedCount} |`);
  }
  if (review.recalls.length === 0) lines.push('| - | 0 | 0 |');
  lines.push('');

  lines.push('## Redacted Fixture Templates');
  lines.push('');
  lines.push('Use observer notes, not raw trace text, to fill these by hand:');
  lines.push('');
  lines.push('```ts');
  lines.push("// DECIDE_CASES: add only if the tester wording exposes a real command-selection miss.");
  lines.push("{ id: 'cohort-YYYYMMDD-short-label', input: { transcript: '<redacted tester wording>' }, expect: 'clarify' },");
  lines.push('');
  lines.push("// EXTRACT_CASES or BEHAVIORAL_EXTRACT_CASES: add only if the turn proves a durable fact/null-discipline gap.");
  lines.push("{ id: 'cohort-YYYYMMDD-short-label', input: { transcript: '<redacted tester wording>', narration: '<redacted summary>', outcome: 'answered' }, expect: 'fact' },");
  lines.push('```');
  lines.push('');
  lines.push('Review rule: paraphrase away names, repo paths, secrets, customer data, and distinctive project language before committing a fixture.');
  lines.push('');
  return lines.join('\n');
}

function fixtureAction(item: ExtractTraceObservation): string {
  if (item.stage === 'gated') {
    return 'If observer notes show a missed durable preference, add a redacted extract fixture that captures the gate miss.';
  }
  if (item.stage === 'noop') {
    return 'If the user expected memory, add a redacted fact fixture; otherwise consider a null-discipline fixture.';
  }
  if (item.stage === 'stored' || item.stage === 'reinforced') {
    return 'Add no fixture unless review shows the stored fact was wrong, too thin, or privacy-sensitive.';
  }
  if (item.stage === 'failed') {
    return 'Fix the product failure first; add a fixture only after the intended behavior is clear.';
  }
  return 'Review observer notes and add only a generalized fixture with a clear expected result.';
}

function reviewDetail(item: ExtractTraceObservation): string {
  if (item.factKey) return item.factKey;
  if (item.stage === 'failed') return item.reason ? 'failed (reason withheld)' : 'failed';
  return item.reason || '-';
}
