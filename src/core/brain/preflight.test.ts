import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tags: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('./ollama', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ollama')>()),
  ollamaTags: mocks.tags,
  ollamaEmbed: mocks.embed,
}));

import { preflight } from './index';

const vec = Array.from({ length: 768 }, () => 0);

describe('preflight — text core readiness', () => {
  beforeEach(() => {
    mocks.tags.mockReset();
    mocks.embed.mockReset();
    mocks.embed.mockResolvedValue([vec]);
    delete process.env.BRAIN_PROVIDER;
    delete process.env.OLLAMA_EMBED_DIM;
  });

  it('passes when reason + embed are installed, even if optional vision is missing', async () => {
    mocks.tags.mockResolvedValue(['qwen2.5:3b', 'nomic-embed-text:latest']);

    const result = await preflight();

    expect(result.missing).toEqual([]);
    expect(result.found.sort()).toEqual(['nomic-embed-text', 'qwen2.5:3b']);
    expect(mocks.embed).toHaveBeenCalledWith('nomic-embed-text', 'preflight embedding dimension probe');
  });

  it('fails loud when an essential model is missing, without requiring the optional vision model', async () => {
    mocks.tags.mockResolvedValue(['qwen2.5:3b']);

    await expect(preflight()).rejects.toThrow(/nomic-embed-text/);
    await expect(preflight()).rejects.not.toThrow(/qwen2\.5vl:7b/);
  });
});
