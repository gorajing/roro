import { describe, it, expect, vi } from 'vitest';
import { ensureWorkdirReady } from './workdirSetup';

describe('ensureWorkdirReady', () => {
  it('allows a coding turn when a workdir is already configured', async () => {
    const chooseWorkdir = vi.fn();
    const onConfigured = vi.fn();
    await expect(ensureWorkdirReady({
      getConfig: async () => ({ workdir: '/repo', source: 'config' }),
      chooseWorkdir,
      onConfigured,
    })).resolves.toBe(true);
    expect(chooseWorkdir).not.toHaveBeenCalled();
    expect(onConfigured).toHaveBeenCalledWith({ workdir: '/repo', source: 'config' });
  });

  it('opens the project picker when no workdir is configured', async () => {
    const onStatus = vi.fn();
    const onConfigured = vi.fn();
    const chooseWorkdir = vi.fn(async () => ({ workdir: '/chosen/repo', source: 'config' as const }));
    await expect(ensureWorkdirReady({
      getConfig: async () => ({ source: 'unset' }),
      chooseWorkdir,
      onStatus,
      onConfigured,
    })).resolves.toBe(true);
    expect(chooseWorkdir).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('Project selected — Roro can run coding tasks.');
    expect(onConfigured).toHaveBeenCalledWith({ workdir: '/chosen/repo', source: 'config' });
  });

  it('blocks the coding turn when the picker is canceled', async () => {
    const onStatus = vi.fn();
    await expect(ensureWorkdirReady({
      getConfig: async () => ({ source: 'unset' }),
      chooseWorkdir: async () => ({ source: 'unset' }),
      onStatus,
    })).resolves.toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith('Choose a project before running a coding task.');
  });

  it('fails loud when setup cannot be checked', async () => {
    const onStatus = vi.fn();
    await expect(ensureWorkdirReady({
      getConfig: async () => { throw new Error('config unavailable'); },
      chooseWorkdir: async () => ({ source: 'unset' }),
      onStatus,
    })).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith('Project setup failed: config unavailable');
  });
});
