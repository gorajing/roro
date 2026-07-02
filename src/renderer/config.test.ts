import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadConfig', () => {
  it('keeps the debug bridge off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().debugBridge).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { debugBridge: true } });

    expect(loadConfig().debugBridge).toBe(true);
  });

  it('keeps the floating smoke harness off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().floatingSmoke).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { floatingSmoke: true } });

    expect(loadConfig().floatingSmoke).toBe(true);
  });

  it('makes the floating desktop-pet window the default and honors an explicit opt-out', () => {
    expect(loadConfig().floatingWindow).toBe(true); // floating is the product default (RORO_CFG absent)

    vi.stubGlobal('window', { RORO_CFG: { floatingWindow: false } });

    expect(loadConfig().floatingWindow).toBe(false); // RORO_FLOATING_WINDOW=0 → MAIN passes false → framed
  });

  it('keeps the Memory panel smoke harness off by default and honors explicit runtime opt-in', () => {
    expect(loadConfig().memoryPanelSmoke).toBe(false);

    vi.stubGlobal('window', { RORO_CFG: { memoryPanelSmoke: true } });

    expect(loadConfig().memoryPanelSmoke).toBe(true);
  });
});
