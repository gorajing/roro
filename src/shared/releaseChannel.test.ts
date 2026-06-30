import { describe, expect, it } from 'vitest';
import { resolveChannel, isReleaseChannel, guardDeferredEnv } from './releaseChannel';
import { V0_DEFERRED_ENV_KEYS } from './deferredEnvKeys';

describe('releaseChannel', () => {
  describe('resolveChannel', () => {
    it('maps only the exact string "release" to the release channel', () => {
      expect(resolveChannel('release')).toBe('release');
    });
    it('maps everything else — dev, smoke, empty, undefined — to dev', () => {
      for (const raw of ['dev', 'smoke', '', 'Release', 'RELEASE', undefined]) {
        expect(resolveChannel(raw)).toBe('dev');
      }
    });
  });

  describe('isReleaseChannel', () => {
    it('is true only for the release channel', () => {
      expect(isReleaseChannel('release')).toBe(true);
      expect(isReleaseChannel('dev')).toBe(false);
    });
  });

  describe('guardDeferredEnv', () => {
    const env = {
      RORO_WS5_STORE: '1',
      RORO_DEBUG_BRIDGE: '1',
      RORO_FAKE_VOICE: '1',
      LIVE2D_MODEL_URL: 'https://x/model.json',
      RORO_MEMORY_HEALTH_SMOKE_FAIL: 'keychain',
      // a NON-deferred key must always survive
      RORO_FLOATING_WINDOW: '1',
    };

    it('strips EVERY deferred-v0 key on the release channel', () => {
      const guarded = guardDeferredEnv(env, 'release');
      for (const key of V0_DEFERRED_ENV_KEYS) {
        expect(guarded[key]).toBeUndefined();
      }
      // non-deferred env is preserved
      expect(guarded.RORO_FLOATING_WINDOW).toBe('1');
    });

    it('passes the env through UNCHANGED on the dev/smoke channel (smokes still work)', () => {
      expect(guardDeferredEnv(env, 'dev')).toBe(env);
    });

    it('is pure — never mutates the input env', () => {
      const before = { ...env };
      guardDeferredEnv(env, 'release');
      expect(env).toEqual(before);
    });

    it('refuses the runtime-dangerous debug bridge specifically on release', () => {
      expect(guardDeferredEnv({ RORO_DEBUG_BRIDGE: '1' }, 'release').RORO_DEBUG_BRIDGE).toBeUndefined();
      expect(guardDeferredEnv({ RORO_DEBUG_BRIDGE: '1' }, 'dev').RORO_DEBUG_BRIDGE).toBe('1');
    });
  });
});
