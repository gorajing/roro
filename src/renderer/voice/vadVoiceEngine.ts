// src/renderer/voice/vadVoiceEngine.ts — the on-device LISTENING engine (Phases 1–2).
//
// The cat's EARS. Phase 1: on a Silero VAD rising edge it emits onSpeechStart — the <=80ms "I heard you"
// tell, BEFORE any transcript. Phase 2: when the VAD reports end-of-utterance it hands the captured PCM
// to an injected transcriber (whisper base.en); live partials feed the caption tell, the committed final
// reaches onFinalTranscript (-> turnRun, mouth-not-brain). TTS (speak) lands in Phase 3.
//
// Both the VAD SOURCE and the TRANSCRIBER are injected (createSileroVad + whisper in production; fakes in
// tests) so this logic — ear-perk, the mute gate, the commit/partial split, the async-load + transcription
// races, the empty/failed-transcript guards — is unit-testable with no audio hardware and no model.
//
// near-zero-idle: the mic opens only on start() (summon) and is fully released on stop().

import type { NativeVoiceEngine } from './voiceLocalAdapter';
import type { VoiceBackendEvents } from './voiceBackend';
import type { KokoroSpeaker } from './kokoroVoiceEngine';

export interface VadCallbacks {
  /** Speech rising edge — the ear-perk trigger. */
  onSpeechStart(): void;
  /** Trailing silence — end of an utterance; `audio` is the captured 16kHz mono PCM for STT. The engine's
   *  handler is async (it awaits transcription) but never rejects; the VAD ignores the returned promise. */
  onSpeechEnd(audio: Float32Array): void | Promise<void>;
}

/** A running voice-activity detector over the mic (Silero). */
export interface VadSource {
  /** Begin listening (opens the mic). */
  start(): Promise<void>;
  /** Stop + release the mic. */
  destroy(): Promise<void>;
}

/** Construct a VAD over the mic, wired to the given callbacks. */
export type CreateVad = (callbacks: VadCallbacks) => Promise<VadSource>;

/**
 * Transcribe one utterance's PCM to text. `onPartial` (optional) streams in-progress hypotheses for the
 * live caption tell; the resolved string is the COMMITTED transcript. Injected so the engine logic is
 * model-free in tests; the real impl wraps whisper (transformers.js) — see whisperTranscribe.ts.
 */
export type Transcribe = (
  audio: Float32Array,
  opts?: { onPartial?: (text: string) => void },
) => Promise<string>;

export function createVadVoiceEngine(
  createVad: CreateVad,
  transcribe?: Transcribe,
  speaker?: KokoroSpeaker, // the MOUTH (Phase 3): speak() delegates here; stop()/barge-in halts it
): NativeVoiceEngine {
  let vad: VadSource | undefined;
  let emit: VoiceBackendEvents | undefined;
  let muted = false;
  // A generation token guards BOTH async windows: the createVad() model load in start(), AND the per-
  // utterance transcription in onSpeechEnd(). stop() (or a re-summon) bumps `generation`, so a VAD that
  // loads late is discarded, and a transcript that resolves after teardown is dropped (no late mic, no
  // late ear-perk, no late final routed to the brain).
  let generation = 0;
  // Per-utterance mute taint. Each utterance gets its OWN record at onSpeechStart (or onSpeechEnd if the VAD
  // skipped start); engaging mute any time until that record's decode resolves taints THAT record. Because
  // every utterance has a distinct object, a later utterance can never un-taint an earlier in-flight decode
  // (the bug a single shared flag had — async decodes overlap even though VAD start/end do not). A final is
  // dropped if its own record is tainted: "muting an in-flight utterance" = "don't act on this", which the
  // voiceMode pull-gate (current state only) cannot enforce. `capturing` is the live speech-capture window
  // (start→end; these never overlap); `decoding` holds utterances whose async decode is in flight (overlap).
  type Utterance = { tainted: boolean };
  let capturing: Utterance | undefined;
  const decoding = new Set<Utterance>();

  return {
    async start(events: VoiceBackendEvents): Promise<void> {
      const gen = ++generation;
      emit = events;
      const source = await createVad({
        onSpeechStart() {
          capturing = { tainted: muted }; // this utterance's own taint record (true if already muted at start)
          if (!muted && generation === gen) {
            speaker?.stop(); // BARGE-IN (Phase 4): talking over the cat halts its in-flight TTS at once. Safe
            // from self-trigger because the mic stream has echoCancellation (the cat's own voice is removed).
            emit?.onSpeechStart(); // ear-perk; muted/superseded → silent
          }
        },
        async onSpeechEnd(audio: Float32Array) {
          const utt = capturing ?? { tainted: muted }; // own record (VAD may skip onSpeechStart in tests)
          capturing = undefined;
          // No STT wired (Phase 1), muted/tainted (deaf cat — don't even decode), or superseded → ignore.
          if (!transcribe || muted || utt.tainted || generation !== gen) return;
          decoding.add(utt); // setMuted() can now taint THIS decode while it's in flight
          try {
            const text = await transcribe(audio, {
              onPartial: (t) => {
                // Live caption (NOT routed). Suppress if muted, if THIS utterance is tainted (so a mute
                // during decode hides its partials too, not just its final), or if superseded.
                if (!muted && !utt.tainted && generation === gen) emit?.onPartialTranscript(t);
              },
            });
            // Drop if superseded by teardown, or if mute was engaged at any point during the decode (even if
            // since unmuted) — muting an in-flight utterance means "don't act on this".
            if (generation !== gen || utt.tainted) return;
            const committed = text.trim();
            if (committed) emit?.onFinalTranscript(committed); // committed utterance → turnRun
          } catch (err) {
            // STT failure is an EXPECTED, recoverable fault: drop this one utterance and keep listening.
            // Surface it (diagnosable) rather than crash the mic loop or leak an unhandled rejection.
            console.warn('[voice] transcription failed; utterance dropped', err);
          } finally {
            decoding.delete(utt);
          }
        },
      });
      if (generation !== gen) {
        await source.destroy().catch(() => undefined); // stop()/re-summon happened while loading — discard
        return;
      }
      vad = source;
      await vad.start();
    },
    async stop(): Promise<void> {
      generation++; // invalidate any in-flight start() + transcription (decoding finals dropped by gen check)
      capturing = undefined; // abandon any in-progress speech capture
      speaker?.stop(); // halt any in-flight TTS too (the cat stops talking when the engine tears down)
      const v = vad;
      vad = undefined;
      emit = undefined; // detach first so any in-flight callback is dropped
      await v?.destroy();
    },
    async speak(text: string): Promise<void> {
      await speaker?.speak(text); // the MOUTH: Kokoro TTS + lip-sync (no-op until a speaker is injected)
    },
    setMuted(m: boolean): void {
      muted = m;
      if (m) {
        // Taint the live capture + EVERY in-flight decode so their finals drop even if later unmuted. Each
        // record is distinct, so this never touches a future utterance's taint.
        if (capturing) capturing.tainted = true;
        for (const u of decoding) u.tainted = true;
      }
    },
  };
}
