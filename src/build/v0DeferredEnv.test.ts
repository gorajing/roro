import { describe, expect, it } from 'vitest';

type V0DeferredEnvModule = {
  enabledV0DeferredEnv(env: Record<string, string | undefined>): string[];
  stripV0DeferredEnv<T extends Record<string, string | undefined>>(env: T): T;
};

async function loadDeferredEnv(): Promise<V0DeferredEnvModule> {
  return await import('../../scripts/v0-deferred-env.mjs') as V0DeferredEnvModule;
}

describe('v0 deferred env hygiene', () => {
  it('treats renderer smoke harnesses as forbidden in default release env', async () => {
    const { enabledV0DeferredEnv } = await loadDeferredEnv();

    expect(enabledV0DeferredEnv({ RORO_FLOATING_SMOKE: '1' })).toEqual(['RORO_FLOATING_SMOKE']);
    expect(enabledV0DeferredEnv({ RORO_FLOATING_SMOKE: '0' })).toEqual([]);
    expect(enabledV0DeferredEnv({ RORO_MEMORY_PANEL_SMOKE: '1' })).toEqual(['RORO_MEMORY_PANEL_SMOKE']);
    expect(enabledV0DeferredEnv({ RORO_MEMORY_PANEL_SMOKE: '0' })).toEqual([]);
    expect(enabledV0DeferredEnv({ RORO_DISABLE_MEMORY_WARMUP: '1' })).toEqual(['RORO_DISABLE_MEMORY_WARMUP']);
    expect(enabledV0DeferredEnv({ RORO_DISABLE_MEMORY_WARMUP: '0' })).toEqual([]);
    expect(enabledV0DeferredEnv({ RORO_MEMORY_HEALTH_SMOKE_FAIL: 'keychain' })).toEqual(['RORO_MEMORY_HEALTH_SMOKE_FAIL']);
  });

  it('strips renderer smoke harnesses from packaged smoke envs', async () => {
    const { stripV0DeferredEnv } = await loadDeferredEnv();
    const env = {
      RORO_FLOATING_SMOKE: '1',
      RORO_MEMORY_PANEL_SMOKE: '1',
      RORO_DISABLE_MEMORY_WARMUP: '1',
      RORO_DEBUG_BRIDGE: '1',
      RORO_MEMORY_HEALTH_SMOKE_FAIL: 'keychain',
    };

    expect(stripV0DeferredEnv(env)).toBe(env);

    expect(env).toEqual({});
  });
});
