import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapCodexThreadEvent } from './codex';
import { mapClaudeMessage, mapClaudeMessageBlocks, mapClaudeStreamEvent, newClaudeCorrelation } from './claude';
import { CLAUDE_STREAM_SAMPLE } from './__fixtures__/claudeSample';
import type { ActionEvent } from '../shared/events';

// CI enforcement of the mapper contract — the most format-brittle code in the repo had ZERO CI
// coverage (its only check was a manual `npx tsx __fixtures__/check.ts` wired into nothing).
// The mappers deliberately skip unknown types for forward-compat, which converts upstream schema
// drift into SILENT event loss while the run still "completes" — so these tests pin the EXACT
// mapped kind-sequence from a captured live codex stream (v0.139.0) and the documented claude
// sample. If an upstream rename makes events vanish, this fails loudly instead of the product
// quietly showing an empty feed.

function mapCodexFixture(): ActionEvent[] {
  const lines = readFileSync(join(__dirname, '__fixtures__', 'codex_hello.jsonl'), 'utf8').split('\n');
  const out: ActionEvent[] = [];
  let parsed = 0;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    parsed++;
    const ev = mapCodexThreadEvent(JSON.parse(s), 'run_fixture');
    if (ev) out.push(ev);
  }
  expect(parsed).toBe(13); // the fixture itself changed if this moves
  return out;
}

function mapClaudeSample(): ActionEvent[] {
  const out: ActionEvent[] = [];
  const corr = newClaudeCorrelation();
  let emittedStart = false;
  for (const obj of CLAUDE_STREAM_SAMPLE) {
    const delta = mapClaudeStreamEvent(obj, 'run_fixture');
    if (delta) {
      out.push(delta);
      continue;
    }
    const o = obj as Record<string, unknown>;
    if (!emittedStart && o.type === 'system' && o.subtype === 'init') {
      const started = mapClaudeMessage(obj, 'run_fixture', corr);
      if (started) {
        emittedStart = true;
        out.push(started);
        out.push({ kind: 'turn.started', runId: 'run_fixture', ts: 0 });
      }
      continue;
    }
    if (o.type === 'assistant' || o.type === 'user') {
      for (const ev of mapClaudeMessageBlocks(obj, 'run_fixture', corr)) out.push(ev);
      continue;
    }
    const terminal = mapClaudeMessage(obj, 'run_fixture', corr);
    if (terminal) out.push(terminal);
  }
  return out;
}

describe('executor mappers vs captured/documented streams (format-drift tripwire, CI-enforced)', () => {
  it('codex: the live v0.139.0 fixture maps to the exact pinned kind-sequence', () => {
    const kinds = mapCodexFixture().map((e) => e.kind);
    expect(kinds).toEqual([
      'run.started', 'turn.started', 'message', 'command', 'command', 'message',
      'file_change', 'file_change', 'message', 'command', 'command', 'message', 'run.completed',
    ]);
  });

  it('codex: command failure and file-change completion survive the mapping (not just kinds)', () => {
    const events = mapCodexFixture();
    expect(events.some((e) => e.kind === 'command' && e.status === 'failed')).toBe(true);
    expect(events.some((e) => e.kind === 'file_change' && e.status === 'completed')).toBe(true);
  });

  it('claude: the documented 2.1.x sample maps to the exact pinned kind-sequence', () => {
    const kinds = mapClaudeSample().map((e) => e.kind);
    expect(kinds).toEqual([
      'run.started', 'turn.started', 'message.delta', 'message',
      'file_change', 'file_change', 'command', 'command', 'run.completed',
    ]);
  });

  it('claude: tool_use/tool_result correlation pairs the Bash command started->completed', () => {
    const events = mapClaudeSample();
    const commands = events.filter((e) => e.kind === 'command');
    expect(commands.map((c) => (c.kind === 'command' ? c.status : ''))).toEqual(['started', 'completed']);
  });
});
