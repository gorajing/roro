import { describe, it, expect, afterEach } from 'vitest';
import { describeBrain } from './index';

// describeBrain() is the user-visible label for the active brain (shown in the "…is planning the
// task…" beat). It must name the ACTUAL configured local model, and any unsupported BRAIN_PROVIDER
// (the removed cloud fork) must fail loud instead of silently labelling the local default.
describe('describeBrain (truthful brain label)', () => {
  afterEach(() => {
    delete process.env.BRAIN_PROVIDER;
    delete process.env.OLLAMA_MODEL;
  });

  it('names the local Ollama reasoning model by default', () => {
    delete process.env.BRAIN_PROVIDER;
    const label = describeBrain();
    expect(label).toMatch(/Ollama/);
    expect(label).toContain('qwen2.5:3b');
  });

  it('fails loud on a removed/unsupported BRAIN_PROVIDER instead of mislabelling', () => {
    process.env.BRAIN_PROVIDER = 'nebius';
    expect(() => describeBrain()).toThrow(/BRAIN_PROVIDER='nebius' is not supported/);
  });

  it('reflects an OLLAMA_MODEL override', () => {
    process.env.OLLAMA_MODEL = 'llama3.2:3b';
    expect(describeBrain()).toContain('llama3.2:3b');
  });
});
