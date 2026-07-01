export const V0_DEFERRED_ENV_KEYS = [
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
];

export function stripV0DeferredEnv(env) {
  for (const key of V0_DEFERRED_ENV_KEYS) delete env[key];
  return env;
}

export function enabledV0DeferredEnv(env) {
  return V0_DEFERRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    if (value === undefined || value === '') return false;
    if (key === 'RORO_VOICE_PACK' || key === 'RORO_MEMORY_HEALTH_SMOKE_FAIL') return true;
    return value === '1';
  });
}
