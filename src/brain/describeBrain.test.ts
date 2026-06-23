import { describe, it, expect, afterEach } from 'vitest';
import { describeBrain } from './index';

// describeBrain() is the user-visible label for the active brain (shown in the "…is planning the
// task…" beat). It MUST be provider-aware: the old code hardcoded "DeepSeek (Nebius)", which now
// lies whenever the local Ollama default is in use.
describe('describeBrain (provider-aware brain label)', () => {
  afterEach(() => {
    delete process.env.BRAIN_PROVIDER;
    delete process.env.OLLAMA_MODEL;
    delete process.env.NEBIUS_MODEL;
  });

  it('names the local Ollama reasoning model by default — never says Nebius', () => {
    delete process.env.BRAIN_PROVIDER;
    const label = describeBrain();
    expect(label).toMatch(/Ollama/);
    expect(label).toContain('qwen2.5:3b');
    expect(label).not.toMatch(/Nebius/i);
  });

  it('names Nebius + the cloud model when BRAIN_PROVIDER=nebius', () => {
    process.env.BRAIN_PROVIDER = 'nebius';
    const label = describeBrain();
    expect(label).toMatch(/Nebius/);
    expect(label).toContain('DeepSeek');
  });

  it('reflects an OLLAMA_MODEL override', () => {
    process.env.OLLAMA_MODEL = 'llama3.2:3b';
    expect(describeBrain()).toContain('llama3.2:3b');
  });
});
