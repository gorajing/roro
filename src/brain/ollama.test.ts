import { describe, it, expect } from 'vitest';
import { buildChatBody, parseChatLine, accumulateChatStream, buildEmbedBody, hasModel } from './ollama';

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
