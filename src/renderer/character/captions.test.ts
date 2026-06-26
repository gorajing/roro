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
});
