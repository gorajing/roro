import { describe, it, expect, vi, beforeEach } from 'vitest';

// The 3B brain occasionally emits an unparseable/invalid decision (M1 eval saw bad_json failures). A single
// malformed reply should NOT kill the turn — decide() re-asks ONCE for only the JSON object, then commits or
// fails loud. Bounded to one repair (no infinite retry). The ollamaChat call is mocked to script bad/good.

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('./ollama', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ollama')>()),
  ollamaChat: chat,
}));

import { decide } from './index';

describe('decide — one-shot JSON repair (local 3B robustness)', () => {
  beforeEach(() => {
    chat.mockReset();
    delete process.env.BRAIN_PROVIDER; // force the local Ollama path
  });

  it('self-recovers from a malformed first decision via a single repair re-prompt', async () => {
    chat
      .mockResolvedValueOnce('sure, here is the plan — not json at all')
      .mockResolvedValueOnce('{"narration":"on it","command":"run_agent","args":{"task":"x"}}');
    const d = await decide({ transcript: 'do x' });
    expect(d.command).toBe('run_agent');
    expect(chat).toHaveBeenCalledTimes(2); // first + one repair
  });

  it('throws after one FAILED repair (bounded — not infinite retry)', async () => {
    chat.mockResolvedValue('still not valid json');
    await expect(decide({ transcript: 'do x' })).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('does NOT repair a valid first decision (single call)', async () => {
    chat.mockResolvedValueOnce('{"narration":"sure","command":"answer","args":{}}');
    const d = await decide({ transcript: 'hi' });
    expect(d.command).toBe('answer');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('routes a clear on-screen pointing request to capture_screen before asking the model', async () => {
    // Wiring regression: locateGate is unit-tested in isolation and the orchestrator mocks decide(),
    // so WITHOUT this test the single line connecting the gate to decide() can be deleted with the
    // whole suite staying green (verified by mutation) — silently degrading every "point at X" turn
    // to the 3B's routing, which is live-observed broken for pointing intents.
    const d = await decide({ transcript: 'point at the save button on my screen' });

    expect(d.command).toBe('capture_screen');
    expect(d.args).toEqual({ locate: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it('clarifies a referent-less request before asking the model', async () => {
    const d = await decide({ transcript: 'fix it' });

    expect(d.command).toBe('clarify');
    expect(d.narration).toMatch(/what should i fix/i);
    expect(chat).not.toHaveBeenCalled();
  });

  it('clarifies before provider setup, even when Nebius has no API key', async () => {
    const savedApiKey = process.env.NEBIUS_API_KEY;
    process.env.BRAIN_PROVIDER = 'nebius';
    delete process.env.NEBIUS_API_KEY;
    try {
      const d = await decide({ transcript: 'fix it' });
      expect(d.command).toBe('clarify');
      expect(chat).not.toHaveBeenCalled();
    } finally {
      if (savedApiKey === undefined) delete process.env.NEBIUS_API_KEY;
      else process.env.NEBIUS_API_KEY = savedApiKey;
    }
  });

  it('does not steal concrete coding tasks from the model', async () => {
    chat.mockResolvedValueOnce('{"narration":"on it","command":"run_agent","args":{"task":"fix the failing test in calc.py"}}');

    const d = await decide({ transcript: 'fix the failing test in calc.py' });

    expect(d.command).toBe('run_agent');
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
