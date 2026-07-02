import { describe, it, expect } from 'vitest';
import { assertRendererEpisodeKind } from './memory';

describe('assertRendererEpisodeKind (runtime guard — IPC payloads are untrusted)', () => {
  it("rejects kind:'fact' — facts are derived internally and must never be written from the renderer", () => {
    expect(() => assertRendererEpisodeKind('fact')).toThrow(/cannot write kind:'fact'/i);
  });
  it('rejects unknown kinds outright (a typo must not become a stored row)', () => {
    expect(() => assertRendererEpisodeKind('observatoin')).toThrow(/unknown episode kind/i);
    expect(() => assertRendererEpisodeKind(undefined)).toThrow(/unknown episode kind/i);
    expect(() => assertRendererEpisodeKind(42)).toThrow(/unknown episode kind/i);
  });
  it('allows the episode kinds the renderer may persist', () => {
    expect(() => assertRendererEpisodeKind('observation')).not.toThrow();
    expect(() => assertRendererEpisodeKind('narration')).not.toThrow();
    expect(() => assertRendererEpisodeKind('action')).not.toThrow();
  });
});
