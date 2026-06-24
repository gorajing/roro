import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildChatBody,
  parseChatLine,
  accumulateChatStream,
  buildEmbedBody,
  hasModel,
  resolveOllamaEmbedDim,
  assertEmbedDimMatch,
  ollamaChat,
  ollamaTags,
} from './ollama';

describe('ollama pure helpers', () => {
  it('buildChatBody sets format:json + options.temperature only when provided', () => {
    const msgs = [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'u' }];
    expect(buildChatBody({ model: 'm', messages: msgs, stream: false, json: true, temperature: 0.3 })).toEqual({
      model: 'm', messages: msgs, stream: false, format: 'json', options: { temperature: 0.3 },
    });
    // No json, no temperature -> neither key present.
    expect(buildChatBody({ model: 'm', messages: msgs, stream: true })).toEqual({ model: 'm', messages: msgs, stream: true });
  });

  it('parseChatLine extracts the content delta and the done flag; tolerates blanks/garbage', () => {
    expect(parseChatLine('{"message":{"content":"hi"},"done":false}')).toEqual({ delta: 'hi', done: false });
    expect(parseChatLine('{"message":{"content":""},"done":true}')).toEqual({ delta: '', done: true });
    expect(parseChatLine('   ')).toEqual({ delta: '', done: false });
    expect(parseChatLine('not json')).toEqual({ delta: '', done: false });
  });

  it('accumulateChatStream concatenates content and fires onContent per non-empty delta', () => {
    const ndjson = [
      '{"message":{"content":"{\\""},"done":false}',
      '{"message":{"content":"ok"},"done":false}',
      '',
      '{"message":{"content":"\\":true}"},"done":false}',
      '{"message":{"content":""},"done":true}',
    ].join('\n');
    const deltas: string[] = [];
    const full = accumulateChatStream(ndjson, (d) => deltas.push(d));
    expect(full).toBe('{"ok":true}');
    expect(deltas).toEqual(['{"', 'ok', '":true}']); // the empty final delta does not fire
  });

  it('buildEmbedBody passes model + input through', () => {
    expect(buildEmbedBody('nomic-embed-text', 'hello')).toEqual({ model: 'nomic-embed-text', input: 'hello' });
    expect(buildEmbedBody('nomic-embed-text', ['a', 'b'])).toEqual({ model: 'nomic-embed-text', input: ['a', 'b'] });
  });

  it('hasModel tolerates the :latest suffix Ollama appends', () => {
    const tags = ['qwen2.5:3b', 'nomic-embed-text:latest', 'qwen2.5vl:7b'];
    expect(hasModel(tags, 'qwen2.5:3b')).toBe(true);
    expect(hasModel(tags, 'nomic-embed-text')).toBe(true); // installed as ...:latest
    expect(hasModel(tags, 'qwen2.5vl:7b')).toBe(true);
    expect(hasModel(tags, 'llama3.2')).toBe(false);
  });
});

describe('ollama embedding dimension', () => {
  it('resolveOllamaEmbedDim defaults to 768 (nomic-embed-text) when unset or empty', () => {
    expect(resolveOllamaEmbedDim(undefined)).toBe(768);
    expect(resolveOllamaEmbedDim('')).toBe(768);
  });

  it('resolveOllamaEmbedDim honors a positive-integer override so non-768 embedders are usable', () => {
    expect(resolveOllamaEmbedDim('1024')).toBe(1024); // e.g. mxbai-embed-large
    expect(resolveOllamaEmbedDim('384')).toBe(384); // e.g. all-minilm
  });

  it('resolveOllamaEmbedDim fails loud on a non-positive-integer override (never poisons vector(N))', () => {
    for (const bad of ['abc', '0', '-5', '12.5', 'NaN']) {
      expect(() => resolveOllamaEmbedDim(bad)).toThrow(/positive integer/);
    }
  });

  it('assertEmbedDimMatch passes when the probed dimension matches the configured one', () => {
    expect(() => assertEmbedDimMatch('nomic-embed-text', 768, 768)).not.toThrow();
  });

  it('assertEmbedDimMatch fails loud with the OLLAMA_EMBED_DIM remedy on a mismatch', () => {
    expect(() => assertEmbedDimMatch('mxbai-embed-large', 1024, 768)).toThrow(/OLLAMA_EMBED_DIM=1024/);
  });
});

describe('ollama fetch timeout (a wedged daemon must fail, not hang)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OLLAMA_TIMEOUT_MS;
  });

  // A fetch that NEVER resolves but honors AbortSignal — simulating a daemon that connected then wedged.
  const hangingFetch = (_url: string, opts?: { signal?: AbortSignal }): Promise<Response> =>
    new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason));
    });

  it('ollamaChat rejects with a TIMEOUT error (not an infinite hang) when the daemon wedges', async () => {
    process.env.OLLAMA_TIMEOUT_MS = '20';
    vi.stubGlobal('fetch', hangingFetch);
    await expect(ollamaChat({ model: 'm', user: 'hi', stream: false })).rejects.toThrow(/timed out/i);
  });

  it('ollamaTags rejects with a TIMEOUT error when /api/tags wedges', async () => {
    process.env.OLLAMA_TIMEOUT_MS = '20';
    vi.stubGlobal('fetch', hangingFetch);
    await expect(ollamaTags()).rejects.toThrow(/timed out/i);
  });
});
