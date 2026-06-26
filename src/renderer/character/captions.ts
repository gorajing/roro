// src/renderer/character/captions.ts — the live captions line + action timeline.
//
// Two DOM-backed views, both fed by the rest of the renderer:
//   - CaptionPanel implements CaptionSink: shows the current user/assistant
//     transcript line (partial updates in place; final lines are committed).
//   - ActionTimeline: an append-only log of ActionEvents (and run-end markers).
//
// All DOM ids are looked up once; missing elements are tolerated (the panel just
// no-ops) so this is safe to construct before the DOM is fully built.

import type { CaptionSink } from './types';
import type { ActionEvent } from '../../shared/events';
import { actionableErrorCopy } from '../events/errorCopy';

export class CaptionPanel implements CaptionSink {
  private partialEl: HTMLElement | null;
  private finalEl: HTMLElement | null;

  constructor(partialId = 'caption-partial', finalId = 'caption-final') {
    this.partialEl = document.getElementById(partialId);
    this.finalEl = document.getElementById(finalId);
  }

  update(role: 'user' | 'assistant', text: string, isFinal: boolean): void {
    const line = `${role === 'user' ? 'You' : 'Roro'}: ${text}`;
    if (isFinal) {
      if (this.finalEl) this.finalEl.textContent = line;
      if (this.partialEl) this.partialEl.textContent = '';
    } else if (this.partialEl) {
      this.partialEl.textContent = line;
    }
  }
}

function statusText(status: 'started' | 'completed' | 'failed'): string {
  switch (status) {
    case 'started':
      return 'Working';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Needs attention';
  }
}

function fileSummary(e: Extract<ActionEvent, { kind: 'file_change' }>): string {
  if (e.files.length === 0) return 'files';
  if (e.files.length === 1) {
    const file = e.files[0];
    return `${file.op} ${file.path}`;
  }
  return `${e.files.length} files`;
}

function summarizeEvent(e: ActionEvent): { label: string; detail: string; status?: string } {
  switch (e.kind) {
    case 'run.started':
      return { label: `${e.agent === 'claude' ? 'Claude' : 'Codex'} started`, detail: '' };
    case 'turn.started':
      return { label: 'Task accepted', detail: '' };
    case 'reasoning':
      // This event comes from the EXECUTOR (the coding agent), not the Nebius
      // brain — the brain's reasoning streams over a separate channel. Label it
      // honestly as the agent's reasoning.
      return { label: 'Agent is thinking', detail: e.text };
    case 'command':
      return { label: `${statusText(e.status)} command`, detail: e.command, status: e.status };
    case 'file_change':
      return {
        label: `${statusText(e.status)} file changes`,
        detail: fileSummary(e),
        status: e.status,
      };
    case 'tool':
      return { label: `${statusText(e.status)} ${e.tool}`, detail: e.summary ?? '', status: e.status };
    case 'message.delta':
      return { label: 'Roro is drafting', detail: e.text };
    case 'message':
      return { label: 'Roro said', detail: e.text };
    case 'status':
      return { label: 'Status', detail: e.text };
    case 'run.completed':
      return { label: 'Run finished', detail: e.finalText ?? '', status: 'completed' };
    case 'run.failed':
      return { label: 'Run needs attention', detail: actionableErrorCopy(e.error), status: 'failed' };
    default: {
      // Exhaustiveness guard: if a new ActionEvent kind is added, this errors.
      const _never: never = e;
      return { label: 'event', detail: String(_never) };
    }
  }
}

export class ActionTimeline {
  private listEl: HTMLElement | null;
  private readonly max: number;

  constructor(listId = 'timeline', max = 200) {
    this.listEl = document.getElementById(listId);
    this.max = max;
  }

  append(e: ActionEvent): void {
    if (!this.listEl) return;
    const { label, detail, status } = summarizeEvent(e);
    const row = document.createElement('div');
    row.className = 'timeline-row' + (status ? ` status-${status}` : '');

    const time = new Date(e.ts).toLocaleTimeString();
    const kindEl = document.createElement('span');
    kindEl.className = 'tl-kind';
    kindEl.textContent = label;

    const detailEl = document.createElement('span');
    detailEl.className = 'tl-detail';
    detailEl.textContent = detail;

    const timeEl = document.createElement('span');
    timeEl.className = 'tl-time';
    timeEl.textContent = time;

    row.append(timeEl, kindEl, detailEl);
    this.listEl.prepend(row); // newest first
    this.trim();
  }

  marker(text: string): void {
    if (!this.listEl) return;
    const row = document.createElement('div');
    row.className = 'timeline-row status-marker';
    row.textContent = text;
    this.listEl.prepend(row);
    this.trim();
  }

  private trim(): void {
    if (!this.listEl) return;
    while (this.listEl.childElementCount > this.max) {
      this.listEl.lastElementChild?.remove();
    }
  }
}
