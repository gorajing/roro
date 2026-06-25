// src/renderer/voice/voiceActivation.ts — the consent-gated Voice Mode start orchestrator.
//
// Turns a "Voice Mode" click into a deliberate, fail-loud start: probe the voice-specific preconditions
// (mic permission + staged weights), and ONLY if they pass, prompt for mic consent when undecided, then open
// the mic. Never opens the mic silently and never leaves a dead button — every refusal is reported with an
// actionable reason. All IO (mic status/request, the weights HEAD, summon) is injected so the branching is
// unit-tested; bootstrap supplies the real bridges.

import { voiceReadiness, type MicStatus } from './voiceReadiness';

export interface VoiceActivationDeps {
  /** Which capabilities the mode uses (STT to hear, TTS to speak) — gates which weights must be present. */
  want: { stt: boolean; tts: boolean };
  /** Current macOS TCC mic status (no prompt). */
  micStatus: () => Promise<MicStatus>;
  /** Trigger the mic consent prompt (a user gesture must be in scope). Resolves to the post-prompt status. */
  requestMic: () => Promise<MicStatus>;
  /** Are the staged weights for a capability present same-origin? Only called for a WANTED capability. */
  weightsPresent: (which: 'stt' | 'tts') => Promise<boolean>;
  /** Open the mic (createVoiceMode.summon). May reject (getUserMedia/VAD/model load). */
  summon: () => Promise<void>;
  /** Surface a user-facing status line (setStatus). */
  report: (message: string) => void;
}

/** Returns true only when the mic was opened. Any blocker/decline/failure reports a reason and returns false. */
export async function activateVoice(deps: VoiceActivationDeps): Promise<boolean> {
  const [mic, sttWeightsPresent, ttsWeightsPresent] = await Promise.all([
    deps.micStatus(),
    deps.want.stt ? deps.weightsPresent('stt') : Promise.resolve(true),
    deps.want.tts ? deps.weightsPresent('tts') : Promise.resolve(true),
  ]);

  const readiness = voiceReadiness({ mic, sttWeightsPresent, ttsWeightsPresent, want: deps.want });
  if (!readiness.ready) {
    deps.report(readiness.blockers.join('  '));
    return false;
  }

  // Ready, but the mic may be undecided — starting Voice Mode is the user gesture that prompts for it.
  if (mic !== 'granted') {
    const after = await deps.requestMic();
    if (after !== 'granted') {
      deps.report('Microphone access is needed for Voice Mode — enable it in System Settings → Privacy → Microphone, then try again.');
      return false;
    }
  }

  try {
    await deps.summon();
  } catch (e) {
    deps.report(`Voice failed to start: ${e instanceof Error ? e.message : String(e)} — the typed path still works.`);
    return false;
  }
  return true;
}
