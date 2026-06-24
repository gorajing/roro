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
});
