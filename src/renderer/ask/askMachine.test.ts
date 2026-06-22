import { describe, it, expect } from 'vitest';
import { askReduce, INITIAL_ASK_STATE } from './askMachine';

describe('askMachine', () => {
  it('starts collapsed', () => {
    expect(INITIAL_ASK_STATE).toBe('collapsed');
  });

  it('summon from collapsed expands, focuses, and pokes', () => {
    const r = askReduce('collapsed', { type: 'summon' });
    expect(r.state).toBe('expanded');
    expect(r.effects).toEqual([{ type: 'focusInput' }, { type: 'poke' }]);
  });

  it("summon while expanded is a no-op (window-level hide is the shell's job)", () => {
    expect(askReduce('expanded', { type: 'summon' })).toEqual({ state: 'expanded', effects: [] });
  });

  it('dismiss from expanded collapses', () => {
    expect(askReduce('expanded', { type: 'dismiss' })).toEqual({ state: 'collapsed', effects: [{ type: 'collapse' }] });
  });

  it('dismiss from collapsed/tasked is a no-op', () => {
    expect(askReduce('collapsed', { type: 'dismiss' })).toEqual({ state: 'collapsed', effects: [] });
    expect(askReduce('tasked', { type: 'dismiss' })).toEqual({ state: 'tasked', effects: [] });
  });

  it('empty/whitespace submit never sets a pose (checked before any effect)', () => {
    for (const text of ['', '   ', '\n\t']) {
      const r = askReduce('expanded', { type: 'submit', text });
      expect(r.state).toBe('expanded');
      expect(r.effects).toEqual([]);
    }
  });

  it('non-empty submit sets the thinking pose FIRST, then starts the turn, then shows tasked (trimmed)', () => {
    const r = askReduce('expanded', { type: 'submit', text: '  add a logout route  ' });
    expect(r.state).toBe('tasked');
    expect(r.effects).toEqual([
      { type: 'setThinkingPose' },
      { type: 'startTurn', text: 'add a logout route' },
      { type: 'showTasked', text: 'add a logout route' },
    ]);
    expect(r.effects[0]).toEqual({ type: 'setThinkingPose' }); // shell sets the pose before awaiting turnRun
  });

  it('submit while tasked is ignored (one turn at a time)', () => {
    expect(askReduce('tasked', { type: 'submit', text: 'another task' })).toEqual({ state: 'tasked', effects: [] });
  });

  it('runStarted while tasked arms Stop', () => {
    expect(askReduce('tasked', { type: 'runStarted' })).toEqual({ state: 'tasked', effects: [{ type: 'armStop' }] });
  });

  it('runEnded from tasked collapses and disarms Stop', () => {
    expect(askReduce('tasked', { type: 'runEnded' })).toEqual({ state: 'collapsed', effects: [{ type: 'disarmStop' }, { type: 'collapse' }] });
  });

  it('runStarted/runEnded outside tasked are no-ops', () => {
    expect(askReduce('collapsed', { type: 'runStarted' })).toEqual({ state: 'collapsed', effects: [] });
    expect(askReduce('expanded', { type: 'runEnded' })).toEqual({ state: 'expanded', effects: [] });
  });
});
