// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { subscribeActionEvents } from './actionEvents';
import type { CharacterDriver, CaptionSink } from '../character/types';
import type { ActionTimeline } from '../character/captions';
import { SCREEN_CAPTURE_STATUS_TEXT, type ActionEvent } from '../../shared/events';

// Under the local Ollama default, decide() streams CONTENT only — onReasoning never fires (Ollama
// has no reasoning_content channel). The decide phase was therefore going dark (no thinking pose,
// no proof-of-life) because subscribeActionEvents only listened to brain.onReasoning. These tests
// pin the fix: the content stream must also drive the thinking pose, WITHOUT dumping raw JSON.

type BridgeWin = { companion?: unknown; brain?: unknown };
const w = (): BridgeWin => window as unknown as BridgeWin;

function fakeCharacter() {
  const states: string[] = [];
  const activities: unknown[] = [];
  const driver = {
    state: 'idle' as string,
    setState(s: string) { states.push(s); driver.state = s; },
    setActivity(a: unknown) { activities.push(a); },
  };
  return { character: driver as unknown as CharacterDriver, states, activities };
}

const noopTimeline = { append() {}, marker() {} } as unknown as ActionTimeline;

describe('subscribeActionEvents — local brain content stream', () => {
  let contentCb: ((d: string) => void) | undefined;
  let reasoningCb: ((d: string) => void) | undefined;
  beforeEach(() => {
    contentCb = undefined;
    reasoningCb = undefined;
    w().companion = { onActionEvent: () => () => {} };
    // The Ollama default exposes onContent but NOT onReasoning.
    w().brain = { onContent: (cb: (d: string) => void) => { contentCb = cb; return () => {}; } };
  });
  afterEach(() => {
    delete w().companion;
    delete w().brain;
  });

  it('drives the thinking pose from content deltas when there is no reasoning channel', () => {
    const { character, states } = fakeCharacter();
    subscribeActionEvents({ character, timeline: noopTimeline });
    expect(typeof contentCb).toBe('function');
    contentCb!('{"narration":"on it"');
    expect(states).toContain('thinking');
  });

  it('does not leak raw JSON decision tokens into the captions (the planning beat carries the text)', () => {
    const { character } = fakeCharacter();
    const lines: Array<{ who: string; text: string }> = [];
    const captions = { update: (who: string, text: string) => lines.push({ who, text }) } as unknown as CaptionSink;
    subscribeActionEvents({ character, timeline: noopTimeline, captions });
    contentCb!('{"narration":"on it","command":"run_agent"}');
    expect(lines).toHaveLength(0);
  });

  it('surfaces the screen-capture tell as activity without treating it as assistant speech', () => {
    let actionCb: ((e: ActionEvent) => void) | undefined;
    w().companion = {
      onActionEvent: (cb: (e: ActionEvent) => void) => {
        actionCb = cb;
        return () => {};
      },
    };
    w().brain = {};
    const { character, activities } = fakeCharacter();
    const lines: Array<{ who: string; text: string }> = [];
    const captions = { update: (who: string, text: string) => lines.push({ who, text }) } as unknown as CaptionSink;

    subscribeActionEvents({ character, timeline: noopTimeline, captions });
    if (!actionCb) throw new Error('missing action-event subscription');
    actionCb({ kind: 'status', runId: 'r', text: SCREEN_CAPTURE_STATUS_TEXT, ts: 0 });

    expect(activities).toContainEqual({ kind: 'read', text: SCREEN_CAPTURE_STATUS_TEXT });
    expect(lines).toHaveLength(0);
  });

  it('surfaces stopped terminal events without an error pose or stale planning caption', () => {
    let actionCb: ((e: ActionEvent) => void) | undefined;
    w().companion = {
      onActionEvent: (cb: (e: ActionEvent) => void) => {
        actionCb = cb;
        return () => {};
      },
    };
    w().brain = {};
    const { character, states, activities } = fakeCharacter();
    const lines: Array<{ who: string; text: string }> = [];
    const captions = { update: (who: string, text: string) => lines.push({ who, text }) } as unknown as CaptionSink;

    subscribeActionEvents({ character, timeline: noopTimeline, captions });
    if (!actionCb) throw new Error('missing action-event subscription');
    actionCb({ kind: 'run.failed', runId: 'r', ok: false, error: 'aborted', ts: 0 });

    expect(states).toContain('done');
    expect(states).not.toContain('error');
    expect(activities).toContainEqual({ kind: 'success', text: 'stopped' });
    expect(lines).toEqual([{ who: 'assistant', text: 'Stopped.' }]);
  });

  it('shows proof of life for reasoning deltas without exposing raw provider reasoning', () => {
    w().brain = { onReasoning: (cb: (d: string) => void) => { reasoningCb = cb; return () => {}; } };
    const { character, states } = fakeCharacter();
    const lines: Array<{ who: string; text: string }> = [];
    const captions = { update: (who: string, text: string) => lines.push({ who, text }) } as unknown as CaptionSink;

    subscribeActionEvents({ character, timeline: noopTimeline, captions });
    if (!reasoningCb) throw new Error('missing reasoning subscription');
    reasoningCb('raw hidden chain text');

    expect(states).toContain('thinking');
    expect(lines).toEqual([{ who: 'assistant', text: 'Thinking through it...' }]);
    expect(lines.map((line) => line.text).join(' ')).not.toContain('raw hidden chain text');
  });
});
