// src/shared/releaseChannel.ts — the build-time release/cohort channel + deferred-v0 flag guard.
//
// WHY: a real cohort/release build must honour NONE of the deferred-v0 flags (cosmetics fake-door,
// voice, and the runtime-DANGEROUS debug bridge that exposes direct runTask/brain.decide IPC).
// A launch-time env (`.env`, an exported var, argv) must NOT be able to re-enable them on a shipped
// build. So the discriminator is a COMPILE-TIME channel constant baked by Vite `define`
// (`__RORO_BUILD_CHANNEL__`), set only by the release build (`make:release`/`package:release`):
//   - NOT `app.isPackaged` — the packaged smokes are packaged too;
//   - NOT a runtime env — `.env` is loaded at launch and could flip it.
// On the 'release' channel, `guardDeferredEnv` strips every deferred-v0 key so every downstream
// `env.RORO_*` read sees it unset. On any other channel ('dev'/'smoke') the env passes through
// unchanged, so the packaged smokes (which inject `RORO_DEBUG_BRIDGE` at launch on a NON-release build)
// keep working. Pure + channel-injectable so it unit-tests without a real build or env.

import { V0_DEFERRED_ENV_KEYS } from './deferredEnvKeys';

export type BuildChannel = 'release' | 'dev';

/** Map the raw build-channel string to the two channels we enforce ('release' vs everything else). */
export function resolveChannel(raw: string | undefined): BuildChannel {
  return raw === 'release' ? 'release' : 'dev';
}

// Frozen at build time by Vite `define`. Absent in unit tests / tsx (the identifier is undeclared at
// runtime there) — `typeof` keeps that safe and we fall back to 'dev'.
declare const __RORO_BUILD_CHANNEL__: string | undefined;
export const BUILD_CHANNEL: BuildChannel = resolveChannel(
  typeof __RORO_BUILD_CHANNEL__ === 'string' ? __RORO_BUILD_CHANNEL__ : undefined,
);

export function isReleaseChannel(channel: BuildChannel = BUILD_CHANNEL): boolean {
  return channel === 'release';
}

type Env = Record<string, string | undefined>;

/**
 * On the release channel, return a COPY of `env` with every deferred-v0 key removed (so each downstream
 * `env.RORO_*` read resolves to its safe default). On any other channel, return `env` unchanged
 * (behaviour-preserving). Pure — never mutates the input.
 */
export function guardDeferredEnv(env: Env, channel: BuildChannel = BUILD_CHANNEL): Env {
  if (channel !== 'release') return env;
  const guarded: Env = { ...env };
  for (const key of V0_DEFERRED_ENV_KEYS) delete guarded[key];
  return guarded;
}
