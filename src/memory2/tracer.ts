// src/memory2/tracer.ts — the one-way observation tap (the eval substrate).
//
// A diagnostic sink at each memory seam (retrieve / form / consolidate / forget), persisting the score
// COMPONENTS (zuun's `parts`), formation/forget decisions, and ids — the exact internals an offline eval
// consumes to tune weights/decay/consolidation. It is STRICTLY ONE-WAY: it never feeds back into live
// decisions, and a write failure is swallowed (tracing must never break a memory op).
//
// PRIVACY: it logs ids/scores/parts/decisions + the query (the eval key) — but NOT memory result text,
// so an opt-in trace file can't leak the corpus that encrypt-at-rest protects. Gated by RORO_TRACE=1
// (off by default → zero overhead via NOOP_TRACER).

import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

declare const process: { env: Record<string, string | undefined> };

export type TraceEvent =
  | {
      kind: 'recall';
      ownerId: string;
      query: string;
      k: number;
      // The FULL deduped candidate pool (not just the returned top-k), each with its score components and
      // whether it was returned — so an offline eval can replay alternate weights + diagnose near-misses.
      candidates: Array<{ id: string; score: number; cosine?: number; parts: { relevance: number; recency: number; importance: number }; returned: boolean }>;
    }
  | { kind: 'remember'; ownerId: string; id: string; tier: string; sessionId?: string }
  | { kind: 'fact'; ownerId: string; factKey: string; op: 'replace' | 'reinforce'; id: string; confidence?: number; supersededIds?: string[]; sessionId?: string }
  | { kind: 'supersede'; ownerId: string; id: string; sessionId?: string }
  | { kind: 'prune'; ownerId?: string; count: number; ids: string[] };

export interface Tracer {
  /** Record a seam observation. One-way + best-effort: never throws, never returns data to the caller. */
  emit(event: TraceEvent): void;
}

export const NOOP_TRACER: Tracer = { emit() {} };

/** A short keyed-less fingerprint of the recall query — joinable across traces, not human-readable. */
function queryFingerprint(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16);
}

/** Append-only JSONL tracer; stamps each event with a ts. By default the recall QUERY is hashed (it's
 *  often the user transcript — privacy), so an opt-in trace file can't leak it; pass hashQuery=false to
 *  log it plaintext. Swallows all I/O errors (one-way). */
export function createJsonlTracer(path: string, hashQuery = true): Tracer {
  let dirReady = false;
  return {
    emit(event: TraceEvent): void {
      try {
        if (!dirReady) {
          mkdirSync(dirname(path), { recursive: true });
          dirReady = true;
        }
        const out = hashQuery && event.kind === 'recall' ? { ...event, query: queryFingerprint(event.query) } : event;
        appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...out }) + '\n');
      } catch {
        /* tracing is diagnostic — a failed write must never disturb the memory operation */
      }
    },
  };
}

/** RORO_TRACE=1 → a JSONL tracer at RORO_TRACE_FILE (or <dir>/trace.jsonl); else NOOP (zero overhead).
 *  The recall query is hashed unless RORO_TRACE_QUERY=plaintext (opt-in, for local relevance eval). */
export function resolveTracer(dir: string): Tracer {
  if (process.env.RORO_TRACE !== '1') return NOOP_TRACER;
  const hashQuery = process.env.RORO_TRACE_QUERY !== 'plaintext';
  return createJsonlTracer(process.env.RORO_TRACE_FILE || join(dir, 'trace.jsonl'), hashQuery);
}
