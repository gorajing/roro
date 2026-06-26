// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { ActionTimeline } from './captions';
import type { ActionEvent } from '../../shared/events';

describe('ActionTimeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="timeline"></div>';
  });

  it('renders executor spawn failures as actionable setup guidance', () => {
    const timeline = new ActionTimeline();
    const failed: ActionEvent = {
      kind: 'run.failed',
      runId: 'run-1',
      ok: false,
      error: 'spawn codex ENOENT',
      ts: 0,
    };

    timeline.append(failed);

    const text = document.getElementById('timeline')?.textContent ?? '';
    expect(text).toContain('Codex CLI not found');
    expect(text).toContain('RORO_CODEX_BIN');
    expect(text).not.toContain('spawn codex ENOENT');
  });

  it('renders user-stopped runs as neutral stops, not failures', () => {
    const timeline = new ActionTimeline();
    const stopped: ActionEvent = {
      kind: 'run.failed',
      runId: 'run-1',
      ok: false,
      error: 'aborted',
      ts: 0,
    };

    timeline.append(stopped);

    const timelineEl = document.getElementById('timeline');
    const text = timelineEl?.textContent ?? '';
    expect(text).toContain('Run stopped');
    expect(text).toContain('Stopped.');
    expect(text).not.toContain('Run needs attention');
    expect(text).not.toContain('aborted');
    expect(timelineEl?.querySelector('.status-failed')).toBeNull();
  });

  it('renders product-friendly labels instead of raw event kind names', () => {
    const timeline = new ActionTimeline();
    const events: ActionEvent[] = [
      { kind: 'turn.started', runId: 'run-1', ts: 0 },
      { kind: 'command', runId: 'run-1', itemId: 'cmd-1', status: 'started', command: 'npm test', ts: 1 },
      { kind: 'file_change', runId: 'run-1', itemId: 'file-1', status: 'completed', files: [{ op: 'update', path: 'src/app.ts' }], ts: 2 },
      { kind: 'message.delta', runId: 'run-1', text: 'working', ts: 3 },
      { kind: 'message', runId: 'run-1', text: 'done', ts: 4 },
      { kind: 'run.completed', runId: 'run-1', ok: true, finalText: 'finished', ts: 5 },
    ];

    for (const event of events) timeline.append(event);

    const text = document.getElementById('timeline')?.textContent ?? '';
    expect(text).toContain('Task accepted');
    expect(text).toContain('Working command');
    expect(text).toContain('Done file changes');
    expect(text).toContain('Roro is drafting');
    expect(text).toContain('Roro said');
    expect(text).toContain('Run finished');
    expect(text).not.toMatch(/turn\.started|message\.delta|run\.completed|file_change/);
  });
});
