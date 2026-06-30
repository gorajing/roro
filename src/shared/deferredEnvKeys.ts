// src/shared/deferredEnvKeys.ts — the canonical list of "deferred-v0" env flags.
//
// These env vars enable features and harnesses that are CUT FROM v0: the cosmetics fake-door,
// the on-device voice stack, Live2D art, the privileged debug bridge, and the smoke/test harnesses.
// A real cohort/release build must honour NONE of them (see `releaseChannel.ts`).
//
// This list MUST stay identical to `scripts/v0-deferred-env.mjs` (used by the build/release tooling).
// `deferredEnvKeys.test.ts` asserts the two are in sync — drift fails the test, not production.
export const V0_DEFERRED_ENV_KEYS = [
  'LIVE2D_MODEL_URL',
  'RORO_FAKE_VOICE',
  'RORO_VAD_VOICE',
  'RORO_STT_VOICE',
  'RORO_TTS_VOICE',
  'RORO_VOICE_PACK',
  'RORO_WS5_STORE',
  'RORO_DEBUG_BRIDGE',
  'RORO_FLOATING_SMOKE',
  'RORO_MEMORY_PANEL_SMOKE',
  'RORO_DISABLE_MEMORY_WARMUP',
  'RORO_MEMORY_HEALTH_SMOKE_FAIL',
] as const;
