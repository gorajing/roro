// src/renderer/voice/voiceReadiness.ts — the Voice Mode readiness probe.
//
// Voice is mouth-not-brain and OPT-IN: clicking "Voice Mode" must either start cleanly or tell the user
// EXACTLY what's missing — never a silent dead button (fail-loud over silent-degrade). This pure function
// aggregates the VOICE-SPECIFIC preconditions the renderer can check instantly (mic permission + the staged
// weights) into ONE verdict + actionable blockers. The IO that produces the inputs (main-side mic status, a
// same-origin HEAD for the staged weights) is resolved by the caller and passed in, so the decision logic
// stays unit-testable. (Brain/Ollama liveness is a GLOBAL precondition surfaced by the startup preflight and
// is the focus of the M7 first-run milestone — deliberately out of this voice-entry gate.)

export type MicStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

export interface VoiceReadinessInput {
  /** macOS TCC mic status (main-side getMicStatus over IPC). */
  mic: MicStatus;
  /** Are the whisper STT weights staged same-origin? (HEAD /models/<whisper>/config.json) */
  sttWeightsPresent: boolean;
  /** Are the Kokoro TTS weights staged same-origin? */
  ttsWeightsPresent: boolean;
  /** Which capabilities the chosen voice mode uses: STT to hear, TTS to speak. */
  want: { stt: boolean; tts: boolean };
}

export interface VoiceReadiness {
  /** True = Voice Mode can start now (a not-determined mic is fine — starting triggers the consent prompt). */
  ready: boolean;
  /** Every unmet precondition, phrased for the user + actionable. Empty when ready. */
  blockers: string[];
}

export function voiceReadiness(input: VoiceReadinessInput): VoiceReadiness {
  const blockers: string[] = [];

  // A 'denied'/'restricted' mic is a HARD blocker: the OS won't re-prompt, so the user must flip it in
  // System Settings and relaunch. 'not-determined'/'granted'/'unknown' are fine — starting Voice Mode (a
  // user gesture) is what triggers the consent prompt, and an unknown status resolves on that attempt.
  if (input.mic === 'denied' || input.mic === 'restricted') {
    blockers.push('Microphone access is blocked — enable it in System Settings → Privacy → Microphone, then relaunch Roro.');
  }

  // A wanted capability whose weights were never staged would 404 same-origin (allowRemoteModels=false), so
  // surface the exact stage command instead of letting the model load fail opaquely mid-utterance.
  if (input.want.stt && !input.sttWeightsPresent) {
    blockers.push('Speech model not installed — run `RORO_STT_VOICE=1 npm run stage:voice-assets` to download it (~81MB).');
  }
  if (input.want.tts && !input.ttsWeightsPresent) {
    blockers.push('Voice model not installed — run `RORO_TTS_VOICE=1 npm run stage:voice-assets` to download it (~95MB).');
  }

  return { ready: blockers.length === 0, blockers };
}
