import type { ActionEvent } from '../../shared/events';
import { isStoppedTerminalError } from '../../shared/stopped';
import { actionableErrorCopy } from './errorCopy';

export type ReceiptTone = 'success' | 'neutral' | 'error';

export interface TurnReceipt {
  tone: ReceiptTone;
  text: string;
}

export interface TurnReceiptState {
  memorySeen: boolean;
  memoryKnown: number;
  memoryRelated: number;
  changedFiles: Set<string>;
  terminal: 'completed' | 'failed' | null;
  error: string | null;
}

export const initialTurnReceiptState = (): TurnReceiptState => ({
  memorySeen: false,
  memoryKnown: 0,
  memoryRelated: 0,
  changedFiles: new Set(),
  terminal: null,
  error: null,
});

function memoryCounts(text: string): { known: number; related: number } | null {
  const match = text.match(/^Memory: (\d+) known .*?(\d+) related/);
  if (!match) return null;
  return { known: Number(match[1]), related: Number(match[2]) };
}

export function reduceTurnReceipt(state: TurnReceiptState, event: ActionEvent): TurnReceiptState {
  const next: TurnReceiptState = {
    ...state,
    changedFiles: new Set(state.changedFiles),
  };

  if (event.kind === 'status') {
    const counts = memoryCounts(event.text);
    if (counts) {
      next.memorySeen = true;
      next.memoryKnown = counts.known;
      next.memoryRelated = counts.related;
    }
    return next;
  }

  if (event.kind === 'file_change' && event.status === 'completed') {
    for (const file of event.files) next.changedFiles.add(file.path);
    return next;
  }

  if (event.kind === 'run.completed') {
    next.terminal = 'completed';
    next.error = null;
    return next;
  }

  if (event.kind === 'run.failed') {
    next.terminal = 'failed';
    next.error = event.error;
    return next;
  }

  return next;
}

function filePhrase(count: number): string | null {
  if (count <= 0) return null;
  return `Changed ${count} ${count === 1 ? 'file' : 'files'}.`;
}

function memoryPhrase(state: TurnReceiptState): string | null {
  if (!state.memorySeen) return null;
  return state.memoryKnown > 0 || state.memoryRelated > 0 ? 'Memory used.' : 'Memory checked.';
}

export function receiptForTurnEnd(state: TurnReceiptState, cancelRequested = false): TurnReceipt {
  if (cancelRequested) return { tone: 'neutral', text: 'Stopped.' };

  if (state.terminal === 'failed') {
    const error = state.error ?? '';
    if (isStoppedTerminalError(error)) return { tone: 'neutral', text: 'Stopped.' };
    return { tone: 'error', text: `Task hit a problem: ${actionableErrorCopy(error)}` };
  }

  const parts = ['Done.'];
  const files = filePhrase(state.changedFiles.size);
  const memory = memoryPhrase(state);
  if (files) parts.push(files);
  if (memory) parts.push(memory);
  return { tone: 'success', text: parts.join(' ') };
}
