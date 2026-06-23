import { describe, it, expect } from 'vitest';
import { reduceVoiceMode, INITIAL_VOICE_MODE_STATE, type VoiceModeState } from './voiceModeState';

// The Voice Mode FSM drives the summon tell (ear-perk / listening caption / busy pose). Summon-never-
// always-on: it starts 'off' and only opens on an explicit summon. It is pure (no audio, no DOM).
const reduce = (s: VoiceModeState, ...events: Parameters<typeof reduceVoiceMode>[1][]): VoiceModeState =>
  events.reduce((acc, e) => reduceVoiceMode(acc, e), s);

describe('reduceVoiceMode (Voice Mode lifecycle FSM)', () => {
  it('starts off and only opens on an explicit summon (summon-never-always-on)', () => {
    expect(INITIAL_VOICE_MODE_STATE.mode).toBe('off');
    // Stray audio events while off are ignored — the mic isn't open.
    expect(reduce(INITIAL_VOICE_MODE_STATE, { type: 'speechStart' }).mode).toBe('off');
    expect(reduce(INITIAL_VOICE_MODE_STATE, { type: 'summon' }).mode).toBe('listening');
  });

  it('listening -> hearing on speech, hearing -> working on a committed turn', () => {
    const s = reduce(INITIAL_VOICE_MODE_STATE, { type: 'summon' }, { type: 'speechStart' });
    expect(s.mode).toBe('hearing');
    expect(reduce(s, { type: 'turnStarted' }).mode).toBe('working');
  });

  it('returns to listening when the turn ends (stays summoned)', () => {
    const s = reduce(INITIAL_VOICE_MODE_STATE, { type: 'summon' }, { type: 'speechStart' }, { type: 'turnStarted' });
    expect(reduce(s, { type: 'turnEnded' }).mode).toBe('listening');
  });

  it('barge-in: speech while a turn runs stays working (the router handles preempt)', () => {
    const working = reduce(INITIAL_VOICE_MODE_STATE, { type: 'summon' }, { type: 'speechStart' }, { type: 'turnStarted' });
    expect(reduce(working, { type: 'speechStart' }).mode).toBe('working');
  });

  it('unsummon always returns to off, from any mode', () => {
    for (const events of [
      [{ type: 'summon' as const }],
      [{ type: 'summon' as const }, { type: 'speechStart' as const }],
      [{ type: 'summon' as const }, { type: 'speechStart' as const }, { type: 'turnStarted' as const }],
    ]) {
      const s = reduce(INITIAL_VOICE_MODE_STATE, ...events);
      expect(reduce(s, { type: 'unsummon' }).mode).toBe('off');
    }
  });

  it('tracks the mute flag without changing the mode', () => {
    const s = reduce(INITIAL_VOICE_MODE_STATE, { type: 'summon' }, { type: 'setMuted', muted: true });
    expect(s.mode).toBe('listening');
    expect(s.muted).toBe(true);
    expect(reduce(s, { type: 'setMuted', muted: false }).muted).toBe(false);
  });
});
