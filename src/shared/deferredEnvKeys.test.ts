import { describe, expect, it } from 'vitest';
import { V0_DEFERRED_ENV_KEYS } from './deferredEnvKeys';

type V0DeferredEnvModule = {
  V0_DEFERRED_ENV_KEYS: string[];
};

// The app (this TS list) and the build/release tooling (`scripts/v0-deferred-env.mjs`) must agree on
// EXACTLY which env flags are deferred-v0. If they drift, the release-channel guard and the release
// verifier would protect different sets — a security gap. This test makes drift a failing build.
describe('deferredEnvKeys ⇄ scripts/v0-deferred-env.mjs', () => {
  it('is identical (same set) to the build-tooling list', async () => {
    const mod = (await import('../../scripts/v0-deferred-env.mjs')) as V0DeferredEnvModule;
    expect([...V0_DEFERRED_ENV_KEYS].sort()).toEqual([...mod.V0_DEFERRED_ENV_KEYS].sort());
  });
});

it('RORO_EXECUTOR_FACTS is in the deferred list — the executor-facts pilot ships dark BECAUSE of this line', () => {
  // Every gate in the pilot (digest accumulation, IPC registration, renderer mount) reads the flag
  // through guardDeferredEnv; release builds are only dark because this key is stripped. Removing it
  // from the list must fail a test, not just a spec.
  expect(V0_DEFERRED_ENV_KEYS).toContain('RORO_EXECUTOR_FACTS');
});
