import type { BootstrapStatusMsg } from '../shared/ipc';

let current: BootstrapStatusMsg | null = null;

export function getBootstrapStatus(): BootstrapStatusMsg | null {
  return current;
}

export function setBootstrapStatus(status: BootstrapStatusMsg | null): void {
  current = status;
}
