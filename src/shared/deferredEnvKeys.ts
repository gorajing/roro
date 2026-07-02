// src/shared/deferredEnvKeys.ts — the canonical list of "deferred-v0" env flags.
//
// These env vars enable features and harnesses that are CUT FROM v0: the cosmetics fake-door,
// the privileged debug bridge, and the smoke/test harnesses.
// A real cohort/release build must honour NONE of them (see `releaseChannel.ts`).
//
// The RORO_*_VOICE flags are deliberately NOT listed: the on-device voice stack was extracted to
// packages/voice (outside the app's dependency graph), so those env vars have NO reader app-side —
// there is nothing left to guard. They rejoin this list if voice re-integrates behind flags
// (see packages/voice/README.md).
//
// This list MUST stay identical to `scripts/v0-deferred-env.mjs` (used by the build/release tooling).
// `deferredEnvKeys.test.ts` asserts the two are in sync — drift fails the test, not production.
export const V0_DEFERRED_ENV_KEYS = [
  'RORO_WS5_STORE',
  'RORO_DEBUG_BRIDGE',
  'RORO_FLOATING_SMOKE',
  'RORO_MEMORY_PANEL_SMOKE',
  'RORO_DISABLE_MEMORY_WARMUP',
  'RORO_MEMORY_HEALTH_SMOKE_FAIL',
] as const;
