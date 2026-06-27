export function memoryWarmupDisabled(env: Record<string, string | undefined>): boolean {
  return env.RORO_DISABLE_MEMORY_WARMUP === '1';
}
