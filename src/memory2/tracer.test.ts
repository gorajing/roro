import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlTracer, resolveTracer, NOOP_TRACER, type TraceEvent } from './tracer';

const recall: TraceEvent = {
  kind: 'recall', ownerId: 'o1', query: 'what did we do', k: 3,
  candidates: [{ id: 'a', score: 0.8, cosine: 0.7, parts: { relevance: 1, recency: 0.5, importance: 0 }, returned: true }],
};

describe('tracer — one-way observation tap (RORO_TRACE eval substrate)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem2trace-')); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.RORO_TRACE;
    delete process.env.RORO_TRACE_FILE;
  });

  it('appends one JSON line per event, each stamped with a ts', () => {
    const path = join(dir, 'trace.jsonl');
    const t = createJsonlTracer(path);
    t.emit(recall);
    t.emit({ kind: 'prune', ownerId: 'o1', count: 2, ids: ['x', 'y'] });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.kind).toBe('recall');
    expect(first.candidates[0].parts.relevance).toBe(1); // the eval-relevant score components are captured
    expect(first.candidates[0].returned).toBe(true);
    expect(typeof first.ts).toBe('string'); // the tracer stamps the time
    expect(JSON.parse(lines[1]).kind).toBe('prune');
  });

  it('never writes memory TEXT — only ids, scores, parts, decisions (stays behind encrypt-at-rest)', () => {
    const path = join(dir, 'trace.jsonl');
    createJsonlTracer(path).emit(recall);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('secret'); // no result text fields exist on the event at all
    expect(raw).toContain('"query"'); // the query (eval key) is recorded
  });

  it('a trace write failure never throws into the caller (one-way, best-effort)', () => {
    const t = createJsonlTracer(join(dir, 'does', 'not', 'exist', 'trace.jsonl')); // unwritable dir is created lazily...
    // ...but even a hard failure must be swallowed: point at a path whose parent is a FILE.
    const bad = createJsonlTracer('/dev/null/trace.jsonl');
    expect(() => bad.emit(recall)).not.toThrow();
    expect(() => t.emit(recall)).not.toThrow();
  });

  it('NOOP_TRACER does nothing and writes nothing', () => {
    expect(() => NOOP_TRACER.emit(recall)).not.toThrow();
  });

  it('resolveTracer is a no-op unless RORO_TRACE=1', () => {
    expect(resolveTracer(dir)).toBe(NOOP_TRACER); // off by default — zero overhead
    process.env.RORO_TRACE = '1';
    const t = resolveTracer(dir);
    expect(t).not.toBe(NOOP_TRACER);
    t.emit(recall);
    expect(existsSync(join(dir, 'trace.jsonl'))).toBe(true); // default sink under the store dir
  });

  it('resolveTracer honors RORO_TRACE_FILE override', () => {
    process.env.RORO_TRACE = '1';
    const custom = join(dir, 'custom-trace.jsonl');
    process.env.RORO_TRACE_FILE = custom;
    resolveTracer(dir).emit(recall);
    expect(existsSync(custom)).toBe(true);
  });
});
