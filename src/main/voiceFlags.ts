// src/main/voiceFlags.ts — which on-device voice dev flags imply the microphone is opened.
//
// The renderer mounts the on-device voice path on any of RORO_{VAD,STT,TTS,FAKE}_VOICE (window.ts
// threads them as roroCfg). MAIN uses voiceMicNeeded() to decide whether to request macOS TCC mic
// consent UP FRONT: the default typed-only launch never touches the mic, so it must never prompt.

type VoiceEnv = Record<string, string | undefined>;

/**
 * True iff a voice flag that OPENS THE MIC is enabled. VAD/STT/TTS all compose the Silero mic ear;
 * FAKE is a scripted engine with no mic, so it does NOT need consent. Matches window.ts: only the
 * literal '1' counts as enabled.
 */
export function voiceMicNeeded(env: VoiceEnv): boolean {
  return (
    env.RORO_VAD_VOICE === '1' ||
    env.RORO_STT_VOICE === '1' ||
    env.RORO_TTS_VOICE === '1'
  );
}
