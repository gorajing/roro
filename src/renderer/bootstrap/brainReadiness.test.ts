import { describe, it, expect, vi } from 'vitest';
import { createBrainReadinessGate, describeBrainReadinessBlock, ensureBrainReady } from './brainReadiness';
import type { BootstrapStatusMsg } from '../../shared/ipc';

const READY: BootstrapStatusMsg = {
  ready: true,
  needsOllamaInstall: false,
  missing: [],
  essentialBytes: 0,
};

const NEEDS_OLLAMA: BootstrapStatusMsg = {
  ready: false,
  needsOllamaInstall: true,
  missing: [],
  essentialBytes: 0,
};

const MISSING_MODELS: BootstrapStatusMsg = {
  ready: false,
  needsOllamaInstall: false,
  missing: [{ name: 'qwen2.5:3b', bytes: 1_900_000_000 }],
  essentialBytes: 1_900_000_000,
};

describe('ensureBrainReady', () => {
  it('allows a turn when no bootstrap status exists yet', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({ getStatus: async () => null, onStatus })).resolves.toBe(true);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('allows a turn when the local brain is ready', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({ getStatus: async () => READY, onStatus })).resolves.toBe(true);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('blocks a turn when Ollama is not running', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({ getStatus: async () => NEEDS_OLLAMA, onStatus })).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Start Ollama/));
  });

  it('blocks a turn when core models are missing', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({ getStatus: async () => MISSING_MODELS, onStatus })).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/core models/));
  });

  it('blocks with the startup message when the brain is unavailable for another reason', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({
      getStatus: async () => ({ ...READY, ready: false, message: 'Local brain unavailable: timed out' }),
      onStatus,
    })).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith('Local brain unavailable: timed out');
  });

  it('fails closed when readiness cannot be checked', async () => {
    const onStatus = vi.fn();
    await expect(ensureBrainReady({
      getStatus: async () => { throw new Error('IPC down'); },
      onStatus,
    })).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith('Brain readiness check failed: IPC down');
  });
});

describe('describeBrainReadinessBlock', () => {
  it('prefers setup-specific guidance over a generic message', () => {
    expect(describeBrainReadinessBlock({ ...NEEDS_OLLAMA, message: 'raw failure' })).toMatch(/Start Ollama/);
    expect(describeBrainReadinessBlock({ ...MISSING_MODELS, message: 'raw failure' })).toMatch(/core models/);
  });
});

describe('createBrainReadinessGate', () => {
  it('uses cached pushes to block and then unblock turns', async () => {
    let push: ((status: BootstrapStatusMsg | null) => void) | null = null;
    const onStatus = vi.fn();
    const gate = createBrainReadinessGate({
      subscribe: (cb) => { push = cb; return () => { push = null; }; },
      getStatus: async () => null,
    });

    expect(gate.canStartTurn()).toBe(true);
    push?.(NEEDS_OLLAMA);
    expect(gate.canStartTurn()).toBe(false);
    expect(gate.ensureReady(onStatus)).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Start Ollama/));

    push?.(READY);
    expect(gate.canStartTurn()).toBe(true);
    expect(gate.ensureReady(onStatus)).toBe(true);

    gate.dispose();
    expect(push).toBeNull();
  });

  it('recovers a missed startup push by fetching current status once', async () => {
    const gate = createBrainReadinessGate({
      subscribe: () => () => undefined,
      getStatus: async () => MISSING_MODELS,
    });

    await Promise.resolve();
    expect(gate.current()).toEqual(MISSING_MODELS);
    expect(gate.canStartTurn()).toBe(false);
    gate.dispose();
  });
});
