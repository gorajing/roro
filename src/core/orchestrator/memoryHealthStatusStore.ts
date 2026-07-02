import type { MemoryHealthStatusMsg, MemoryHealthStatusReason } from '../../shared/ipc';

let current: MemoryHealthStatusMsg | null = null;

export function getMemoryHealthStatus(): MemoryHealthStatusMsg | null {
  return current;
}

export function setMemoryHealthStatus(status: MemoryHealthStatusMsg | null): void {
  current = status;
}

export function memoryHealthChecking(now = Date.now()): MemoryHealthStatusMsg {
  return { state: 'checking', checkedAt: now };
}

export function memoryHealthOk(): MemoryHealthStatusMsg {
  return { state: 'ok', checkedAt: Date.now() };
}

function reasonFor(message: string): MemoryHealthStatusReason {
  if (!message) return 'unknown';
  if (/memory store is locked|data key is unrecoverable|encrypted corpus cannot be read/i.test(message)) {
    return 'memory-locked';
  }
  if (/keychain|safeStorage|cannot encrypt|encryption unavailable|errSecAuthFailed/i.test(message)) {
    return 'keychain-unavailable';
  }
  return 'store-unavailable';
}

export function memoryHealthFailureFromError(err: unknown): MemoryHealthStatusMsg {
  const raw = err instanceof Error ? err.message : String(err);
  const reason = reasonFor(raw);
  const message =
    reason === 'memory-locked'
      ? 'Roro memory is locked. The OS keychain could not unlock the local memory key, so memory will not load or save until Keychain is fixed and Roro is relaunched.'
      : reason === 'keychain-unavailable'
        ? 'Roro cannot reach the OS keychain for local memory. Roro can still work, but memory will not load or save until Keychain is available and Roro is relaunched.'
        : 'Roro cannot open local memory right now. Roro can still work, but memory will not load or save until this is fixed and Roro is relaunched.';
  return { state: 'degraded', checkedAt: Date.now(), reason, message };
}
