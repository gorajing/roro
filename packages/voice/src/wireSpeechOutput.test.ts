import { describe, it, expect, vi } from 'vitest';
import { wireSpeechOutput } from './wireSpeechOutput';
import type { ActionEvent } from '../../../src/shared/events';

function fakeBus() {
  let cb: ((e: ActionEvent) => void) | undefined;
  return {
    onActionEvent: (c: (e: ActionEvent) => void) => { cb = c; return () => { cb = undefined; }; },
    emit: (e: ActionEvent) => cb?.(e),
  };
}
const msg = (text: string): ActionEvent => ({ kind: 'message', runId: 'r', text, ts: 0 });

describe('wireSpeechOutput — the assistant message -> local TTS (the mouth)', () => {
  it('speaks a committed message ONLY while voice is summoned (active)', () => {
    const bus = fakeBus();
    const spoken: string[] = [];
    let active = true;
    wireSpeechOutput({ onActionEvent: bus.onActionEvent, speak: (t) => { spoken.push(t); }, isActive: () => active });
    bus.emit(msg('on it — adding a test alongside it'));
    expect(spoken).toEqual(['on it — adding a test alongside it']);
    active = false; // a typed turn (voice off) — the cat stays a silent peer
    bus.emit(msg('this one should not be spoken'));
    expect(spoken).toEqual(['on it — adding a test alongside it']);
  });

  it('ignores non-message events + empty message text', () => {
    const bus = fakeBus();
    const spoken: string[] = [];
    wireSpeechOutput({ onActionEvent: bus.onActionEvent, speak: (t) => { spoken.push(t); }, isActive: () => true });
    bus.emit({ kind: 'run.completed', runId: 'r', ok: true, ts: 0 } as ActionEvent);
    bus.emit({ kind: 'reasoning', runId: 'r', itemId: 'i', text: 'thinking', ts: 0 } as ActionEvent);
    bus.emit(msg(''));
    expect(spoken).toEqual([]);
  });

  it('a speak() failure never throws into the event stream (one-way) — sync OR async', async () => {
    const sync = fakeBus();
    wireSpeechOutput({ onActionEvent: sync.onActionEvent, speak: () => { throw new Error('TTS down'); }, isActive: () => true });
    expect(() => sync.emit(msg('boom'))).not.toThrow();

    // an async TTS rejection must not become an unhandled rejection either
    const async = fakeBus();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    wireSpeechOutput({ onActionEvent: async.onActionEvent, speak: () => Promise.reject(new Error('async TTS down')), isActive: () => true });
    async.emit(msg('boom'));
    await new Promise((r) => setTimeout(r, 10)); // let any rejection surface
    process.off('unhandledRejection', onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('unsubscribe detaches', () => {
    const bus = fakeBus();
    const spoken: string[] = [];
    const off = wireSpeechOutput({ onActionEvent: bus.onActionEvent, speak: (t) => { spoken.push(t); }, isActive: () => true });
    off();
    bus.emit(msg('after off'));
    expect(spoken).toEqual([]);
  });
});
