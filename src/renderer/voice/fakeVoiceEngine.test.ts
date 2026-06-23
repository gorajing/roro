import { describe, it, expect } from 'vitest';
import { createFakeVoiceEngine } from './fakeVoiceEngine';
import type { VoiceBackendEvents } from './voiceBackend';

function sink() {
  const ev = { speechStart: 0, partials: [] as string[], finals: [] as string[] };
  const events: VoiceBackendEvents = {
    onSpeechStart: () => { ev.speechStart++; },
    onPartialTranscript: (t) => ev.partials.push(t),
    onFinalTranscript: (t) => ev.finals.push(t),
  };
  return { ev, events };
}

describe('createFakeVoiceEngine — scripted NativeVoiceEngine (no hardware)', () => {
  it('utter() drives ear-perk -> partial -> final into the event sink', async () => {
    const e = createFakeVoiceEngine();
    const { ev, events } = sink();
    await e.start(events);
    e.utter('hello roro');
    expect(ev.speechStart).toBe(1);
    expect(ev.partials).toEqual(['hello roro']);
    expect(ev.finals).toEqual(['hello roro']);
  });

  it('utter() is a no-op before start()', () => {
    const e = createFakeVoiceEngine();
    expect(() => e.utter('x')).not.toThrow();
  });

  it('records speak() + setMuted()', async () => {
    const e = createFakeVoiceEngine();
    await e.speak('on it');
    e.setMuted(true);
    expect(e.spoken).toEqual(['on it']);
    expect(e.muted).toBe(true);
  });

  it('stop() detaches — utter after stop is a no-op', async () => {
    const e = createFakeVoiceEngine();
    const { ev, events } = sink();
    await e.start(events);
    await e.stop();
    e.utter('after stop');
    expect(ev.finals).toEqual([]);
  });
});
