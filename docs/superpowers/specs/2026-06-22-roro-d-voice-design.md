# Roro Phase D — Voice (local) — Design + Status

> **Status:** the **control core is built + tested**; the on-device model integration is
> **hardware-gated** (native binaries + a mic) and lands on a real machine. Per the v2 spine, the
> seam is designed now and nothing in A.5–C depended on it.

## The laws (locked)
- **Mouth-not-brain.** Voice NEVER decides. A committed utterance routes THROUGH `turnRun`
  (recall→decide→execute→remember), exactly like a typed task — never a speech-to-speech model that
  bypasses the orchestrator. This is the whole reason voice rides on A.5/B/C1.
- **Summon, never always-on.** The mic opens behind a deliberate Mode (idle ≈ $0). A persistent
  listening tell + barge-in; not push-to-talk.
- **Local-first / $0.** whisper.cpp (STT) + Silero VAD (turn/barge-in) + Kokoro (TTS), on-device.
  Voice is a **cosmetic surface** (voice packs / a cloned voice), not a metered utility.

## What's built now (hardware-free, tested)
- **`voiceTurnRouter`** (`src/renderer/voice/voiceTurnRouter.ts`, 6 tests) — the mouth-not-brain +
  barge-in core. A final transcript when idle → `turnRun(text)`; mid-run → `cancelTask()` (C1
  preempt) and the queued utterance fires on `runEnd`. Latest utterance wins. Empty/whitespace
  ignored. Pure (`VoiceTurnDeps` injected), no audio.
- **`VoiceBackend`** seam (`src/renderer/voice/voiceBackend.ts`) — the STT/VAD/TTS contract
  (`start/stop/speak/setMuted` + `onSpeechStart`/`onPartial`/`onFinalTranscript`), with a
  `createStubVoiceBackend()` (`available:false`) so the renderer + CI run without a mic.

## Hardware-gated remainder (on a real machine)
- The **local `VoiceBackend` adapter**: bind whisper.cpp + Silero VAD + Kokoro to the interface
  (native modules / WASM + an `AudioWorklet` mic tap). `onSpeechStart` → `driver.poke()` ear-perk
  (≤80ms, pre-network); `onFinalTranscript` → `voiceTurnRouter`; assistant narration → `speak()`.
- **Voice Mode UI**: a summon toggle + a persistent listening tell + the barge-in affordance (the
  interaction spec's "voice = a deliberate Mode").
- These need a device with audio + the native binaries, so they're verified there, not in CI.

## Why this slice now
It removes the two-brain risk (the old Vapi path ran its own LLM in parallel — gone), proves the
mouth-not-brain routing + barge-in against C1's preempt with real tests, and leaves a clean seam the
local models drop into. The legacy Vapi voice (`voice/wireEvents.ts`, `vapiClient.ts`) is superseded
by this local path and is removed when the local adapter lands.
