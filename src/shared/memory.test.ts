import { describe, it, expect } from 'vitest';
import { assertRendererMemoryKind } from './memory';

describe('assertRendererMemoryKind', () => {
  it("rejects kind:'fact' — facts are derived internally and must never be written from the renderer", () => {
    expect(() => assertRendererMemoryKind('fact')).toThrow();
  });
  it('allows the non-derived kinds the renderer may persist', () => {
    expect(() => assertRendererMemoryKind('observation')).not.toThrow();
    expect(() => assertRendererMemoryKind('narration')).not.toThrow();
    expect(() => assertRendererMemoryKind('action')).not.toThrow();
  });
});
