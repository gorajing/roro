import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBootstrapStatus, setBootstrapStatus } from './bootstrapStatusStore';
import { refreshBootstrapStatus } from './bootstrapRefresh';

function brain(over: {
  preflight?: ReturnType<typeof vi.fn>;
  describeBrain?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    preflight: over.preflight ?? vi.fn(async () => ({
      required: { reason: 'qwen2.5:3b', vision: 'qwen2.5vl:7b', embed: 'nomic-embed-text' },
      found: ['qwen2.5:3b', 'nomic-embed-text'],
      missing: [],
    })),
    describeBrain: over.describeBrain ?? vi.fn(() => 'qwen2.5:3b (local Ollama)'),
  };
}

describe('refreshBootstrapStatus', () => {
  beforeEach(() => {
    setBootstrapStatus(null);
  });

  it('runs the brain preflight, stores ready status, and returns model details on success', async () => {
    const b = brain();

    const result = await refreshBootstrapStatus({ loadBrain: async () => b });

    expect(result.ok).toBe(true);
    expect(result.status).toEqual({ ready: true, needsOllamaInstall: false, missing: [], essentialBytes: 0 });
    expect(result.brainDescription).toBe('qwen2.5:3b (local Ollama)');
    expect(result.required?.embed).toBe('nomic-embed-text');
    expect(getBootstrapStatus()).toEqual(result.status);
  });

  it('turns a missing-model preflight failure into actionable pull status', async () => {
    const b = brain({ preflight: vi.fn(async () => { throw new Error('Ollama models missing: qwen2.5:3b'); }) });

    const result = await refreshBootstrapStatus({
      loadBrain: async () => b,
      ollamaTags: async () => [],
    });

    expect(result.ok).toBe(false);
    expect(result.status.ready).toBe(false);
    expect(result.status.needsOllamaInstall).toBe(false);
    expect(result.status.missing.map((m) => m.name).sort()).toEqual(['nomic-embed-text', 'qwen2.5:3b']);
    expect(result.status.message).toMatch(/core models/i);
    expect(getBootstrapStatus()).toEqual(result.status);
  });

  it('uses install/start guidance when Ollama cannot be reached', async () => {
    const b = brain({ preflight: vi.fn(async () => { throw new Error('fetch failed'); }) });

    const result = await refreshBootstrapStatus({
      loadBrain: async () => b,
      ollamaTags: async () => { throw new Error('ECONNREFUSED'); },
    });

    expect(result.status.needsOllamaInstall).toBe(true);
    expect(result.status.message).toMatch(/Ollama/i);
    expect(result.status.message).toMatch(/Install/i);
  });

  it('keeps the precise base message for a degraded daemon timeout', async () => {
    const b = brain({ preflight: vi.fn(async () => { throw new Error('request timed out'); }) });

    const result = await refreshBootstrapStatus({
      loadBrain: async () => b,
      ollamaTags: async () => { throw new Error('timed out while listing models'); },
    });

    expect(result.status.needsOllamaInstall).toBe(false);
    expect(result.status.missing).toEqual([]);
    expect(result.status.message).toBe('Local brain unavailable: request timed out');
  });

  it('does not probe Ollama for Nebius provider failures', async () => {
    const b = brain({ preflight: vi.fn(async () => { throw new Error('Nebius key missing'); }) });
    const tags = vi.fn(async () => []);

    const result = await refreshBootstrapStatus({
      env: { BRAIN_PROVIDER: 'nebius' } as NodeJS.ProcessEnv,
      loadBrain: async () => b,
      ollamaTags: tags,
    });

    expect(tags).not.toHaveBeenCalled();
    expect(result.status.missing).toEqual([]);
    expect(result.status.message).toBe('Local brain unavailable: Nebius key missing');
  });
});
