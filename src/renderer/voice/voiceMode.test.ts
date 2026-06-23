import { describe, it, expect, vi } from 'vitest';
import { createVoiceMode } from './voiceMode';
import { createStubVoiceBackend, type VoiceBackend, type VoiceBackendEvents } from './voiceBackend';

// createVoiceMode is the local-voice integration core: it wires a VoiceBackend's committed utterances
// through the CANONICAL voiceTurnRouter (mouth-not-brain + C1 barge-in), drives the ear-perk tell off
// VAD, and advances the Voice Mode FSM. Tested with a fake backend + fake turn deps (no audio).

/** A controllable backend: captures the events object from start() so the test can drive emissions. */
function fakeBackend(available = true): VoiceBackend & { emit?: VoiceBackendEvents; started: boolean; stopped: boolean } {
  const b = {
    available,
    emit: undefined as VoiceBackendEvents | undefined,
    started: false,
    stopped: false,
    async start(events: VoiceBackendEvents) { b.emit = events; b.started = true; },
    async stop() { b.stopped = true; },
    async speak() {},
    setMuted() {},
  };
  return b;
}

function makeDeps() {
  let runEndCb: ((runId?: string) => void) | undefined;
  return {
    turnRun: vi.fn((_t: string) => Promise.resolve({ runId: 'r1' })),
    cancelTask: vi.fn(),
    isRunActive: vi.fn(() => false),
    onRunEnd: vi.fn((cb: (runId?: string) => void) => { runEndCb = cb; return () => { runEndCb = undefined; }; }),
    fireRunEnd: (runId?: string) => runEndCb?.(runId),
  };
}

const driver = () => ({ poke: vi.fn(), setState: vi.fn() });

describe('createVoiceMode (local-voice integration core)', () => {
  it('exposes the backend availability and stays off until summoned', () => {
    const mode = createVoiceMode({ backend: createStubVoiceBackend(), deps: makeDeps(), driver: driver() });
    expect(mode.available).toBe(false); // stub backend
    expect(mode.state.mode).toBe('off');
  });

  it('summon() starts the backend and opens to listening; unsummon() stops it', async () => {
    const backend = fakeBackend();
    const mode = createVoiceMode({ backend, deps: makeDeps(), driver: driver() });
    await mode.summon();
    expect(backend.started).toBe(true);
    expect(mode.state.mode).toBe('listening');
    await mode.unsummon();
    expect(backend.stopped).toBe(true);
    expect(mode.state.mode).toBe('off');
  });

  it('VAD speech-start pokes the avatar (ear-perk) and moves to hearing', async () => {
    const backend = fakeBackend();
    const d = driver();
    const mode = createVoiceMode({ backend, deps: makeDeps(), driver: d });
    await mode.summon();
    backend.emit!.onSpeechStart();
    expect(d.poke).toHaveBeenCalledOnce();
    expect(mode.state.mode).toBe('hearing');
  });

  it('routes a committed utterance through turnRun (mouth-not-brain) and goes to working', async () => {
    const backend = fakeBackend();
    const deps = makeDeps();
    const mode = createVoiceMode({ backend, deps, driver: driver() });
    await mode.summon();
    backend.emit!.onSpeechStart();
    backend.emit!.onFinalTranscript('add a logout route');
    expect(deps.turnRun).toHaveBeenCalledWith('add a logout route');
    expect(mode.state.mode).toBe('working');
  });

  it('a muted final is NOT routed to turnRun and returns to listening (hard gate)', async () => {
    const backend = fakeBackend();
    const deps = makeDeps();
    const mode = createVoiceMode({ backend, deps, driver: driver(), isMuted: () => true });
    await mode.summon();
    backend.emit!.onSpeechStart();
    backend.emit!.onFinalTranscript('secret aside, do not run');
    expect(deps.turnRun).not.toHaveBeenCalled();
    expect(mode.state.mode).toBe('listening');
  });

  it('returns to listening when the routed turn ends', async () => {
    const backend = fakeBackend();
    const deps = makeDeps();
    const mode = createVoiceMode({ backend, deps, driver: driver() });
    await mode.summon();
    backend.emit!.onFinalTranscript('do a thing');
    expect(mode.state.mode).toBe('working');
    deps.fireRunEnd('r1');
    expect(mode.state.mode).toBe('listening');
  });

  it('summon() superseded by unsummon() during a slow backend load does NOT flip the mode back to listening', async () => {
    // A backend whose start() is deferred (a slow model load).
    let resolveStart!: () => void;
    const slow: VoiceBackend = {
      available: true,
      start: () => new Promise<void>((r) => { resolveStart = r; }),
      async stop() {},
      async speak() {},
      setMuted() {},
    };
    const mode = createVoiceMode({ backend: slow, deps: makeDeps(), driver: driver() });
    const summoning = mode.summon(); // in-flight (start pending)
    await mode.unsummon(); // teardown DURING the load
    resolveStart(); // start resolves late
    await summoning;
    expect(mode.state.mode).toBe('off'); // the late summon must not flip it back to 'listening'
  });

  it('dispose() during a slow backend load also suppresses the late summon (no FSM resurrection)', async () => {
    let resolveStart!: () => void;
    const slow: VoiceBackend = {
      available: true,
      start: () => new Promise<void>((r) => { resolveStart = r; }),
      async stop() {},
      async speak() {},
      setMuted() {},
    };
    const mode = createVoiceMode({ backend: slow, deps: makeDeps(), driver: driver() });
    const summoning = mode.summon();
    mode.dispose(); // teardown during the load
    resolveStart();
    await summoning;
    expect(mode.state.mode).toBe('off'); // dispose bumped the epoch -> the late summon is suppressed
  });
});
