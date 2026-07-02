import { describe, it, expect, vi } from 'vitest';
import { activateVoice, type VoiceActivationDeps } from './voiceActivation';
import type { MicStatus } from './voiceReadiness';

// activateVoice orchestrates the consent-gated start: probe (mic + staged weights) -> if blocked, report and
// stop; else prompt for mic consent when undecided; else fail loud. It returns true only when the mic is open.
// All IO (mic status/request, weights HEAD, summon) is injected so the branching is unit-tested.

const granted = async (): Promise<MicStatus> => 'granted';

function deps(over: Partial<VoiceActivationDeps> = {}): VoiceActivationDeps {
  return {
    want: { stt: true, tts: true },
    micStatus: granted,
    requestMic: vi.fn(granted),
    weightsPresent: vi.fn(async () => true),
    summon: vi.fn(async () => undefined),
    report: vi.fn(),
    ...over,
  };
}

describe('activateVoice', () => {
  it('summons when mic is granted and weights are present (no consent prompt needed)', async () => {
    const d = deps();
    const ok = await activateVoice(d);
    expect(ok).toBe(true);
    expect(vi.mocked(d.summon)).toHaveBeenCalledOnce();
    expect(vi.mocked(d.requestMic)).not.toHaveBeenCalled();
    expect(vi.mocked(d.report)).not.toHaveBeenCalled();
  });

  it('prompts for consent on a not-determined mic, then summons when granted', async () => {
    const d = deps({ micStatus: async () => 'not-determined', requestMic: vi.fn(granted) });
    const ok = await activateVoice(d);
    expect(ok).toBe(true);
    expect(vi.mocked(d.requestMic)).toHaveBeenCalledOnce();
    expect(vi.mocked(d.summon)).toHaveBeenCalledOnce();
  });

  it('does NOT summon when the user declines the consent prompt — reports why', async () => {
    const d = deps({ micStatus: async () => 'not-determined', requestMic: vi.fn(async (): Promise<MicStatus> => 'denied') });
    const ok = await activateVoice(d);
    expect(ok).toBe(false);
    expect(vi.mocked(d.summon)).not.toHaveBeenCalled();
    expect(vi.mocked(d.report)).toHaveBeenCalledWith(expect.stringMatching(/microphone/i));
  });

  it('blocks on a hard-denied mic without ever prompting or summoning', async () => {
    const d = deps({ micStatus: async () => 'denied' });
    const ok = await activateVoice(d);
    expect(ok).toBe(false);
    expect(vi.mocked(d.requestMic)).not.toHaveBeenCalled();
    expect(vi.mocked(d.summon)).not.toHaveBeenCalled();
    expect(vi.mocked(d.report)).toHaveBeenCalledWith(expect.stringMatching(/System Settings/i));
  });

  it('blocks with the stage command when wanted weights are missing — no summon', async () => {
    const d = deps({ weightsPresent: vi.fn(async (which) => which !== 'stt') });
    const ok = await activateVoice(d);
    expect(ok).toBe(false);
    expect(vi.mocked(d.summon)).not.toHaveBeenCalled();
    expect(vi.mocked(d.report)).toHaveBeenCalledWith(expect.stringMatching(/stage:voice-assets/));
  });

  it('does not check weights for a capability the mode does not want (VAD-only)', async () => {
    const d = deps({ want: { stt: false, tts: false }, weightsPresent: vi.fn(async () => true) });
    const ok = await activateVoice(d);
    expect(ok).toBe(true);
    expect(vi.mocked(d.weightsPresent)).not.toHaveBeenCalled();
  });

  it('fails loud (not silent) when summon() throws — reports and returns false', async () => {
    const d = deps({ summon: vi.fn(async () => { throw new Error('getUserMedia denied'); }) });
    const ok = await activateVoice(d);
    expect(ok).toBe(false);
    expect(vi.mocked(d.report)).toHaveBeenCalledWith(expect.stringMatching(/getUserMedia denied/));
  });
});
