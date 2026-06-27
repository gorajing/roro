// src/shared/events.ts — the single canonical ActionEvent. Imported by main, preload, renderer.
// Owned by the executor-adapter; FROZEN (11 kinds; `status` added in C1, then RE-FROZEN).
// Do not add kinds without updating eventToAvatarState. Confirm/deny is NOT a kind — it rides a
// separate request/response IPC pair (CH.confirmRequest / CH.confirmResolve).
export type AgentKind = 'codex' | 'claude';

export type ActionEvent =
  | { kind: 'run.started';   agent: AgentKind; runId: string; threadId?: string; ts: number }
  | { kind: 'turn.started';  runId: string; ts: number }
  | { kind: 'reasoning';     runId: string; itemId: string; text: string; ts: number }            // ONLY event -> avatar 'thinking'
  | { kind: 'command';       runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; command: string; output?: string; exitCode?: number; ts: number }
  | { kind: 'file_change';   runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; files: { path: string; op: 'add' | 'update' | 'delete' }[]; ts: number }
  | { kind: 'tool';          runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; server?: string; tool: string; summary?: string; ts: number }
  | { kind: 'message.delta'; runId: string; text: string; ts: number }                            // streaming assistant tokens
  | { kind: 'message';       runId: string; text: string; ts: number }                            // final assistant text
  | { kind: 'status';        runId: string; text: string; ts: number }                            // legible non-action beat (e.g. memory recall) — never assistant text
  | { kind: 'run.completed'; runId: string; ok: true;  finalText?: string; usage?: unknown; ts: number }
  | { kind: 'run.failed';    runId: string; ok: false; error: string; ts: number };

export interface ExecutorRunOptions { repo: string; prompt: string; agent?: AgentKind; signal?: AbortSignal }
export interface Executor { run(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> }

export const SCREEN_CAPTURE_STATUS_TEXT = 'Taking one screen snapshot.';

export interface MemoryStatusCounts {
  factCount: number;
  episodeCount: number;
}

export function formatMemoryStatus({ factCount, episodeCount }: MemoryStatusCounts): string {
  return `Memory: ${factCount} known ${factCount === 1 ? 'fact' : 'facts'}, ${episodeCount} related ${episodeCount === 1 ? 'item' : 'items'}`;
}

export function parseMemoryStatus(text: string): MemoryStatusCounts | null {
  const match = text.match(/^Memory: (\d+) known (?:fact|facts), (\d+) related (?:item|items)$/);
  if (!match) return null;
  return { factCount: Number(match[1]), episodeCount: Number(match[2]) };
}

export const newRunId = (): string => `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
