import { describe, it, expect } from 'vitest';
import { withCrossOriginIsolation, CROSS_ORIGIN_ISOLATION_HEADERS } from './crossOriginIsolation';

describe('withCrossOriginIsolation — the renderer cross-origin-isolation headers (voice WASM threads)', () => {
  it('adds COOP same-origin + COEP credentialless', () => {
    const out = withCrossOriginIsolation({});
    expect(out['Cross-Origin-Opener-Policy']).toEqual(['same-origin']);
    expect(out['Cross-Origin-Embedder-Policy']).toEqual(['credentialless']); // NOT require-corp (model downloads)
  });

  it('preserves unrelated response headers', () => {
    const out = withCrossOriginIsolation({ 'Content-Type': ['text/html'], 'X-Frame-Options': ['DENY'] });
    expect(out['Content-Type']).toEqual(['text/html']);
    expect(out['X-Frame-Options']).toEqual(['DENY']);
  });

  it('replaces an existing COOP/COEP (case-insensitive) so ours win', () => {
    const out = withCrossOriginIsolation({
      'cross-origin-opener-policy': ['unsafe-none'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'content-type': ['text/html'],
    });
    // exactly one COOP + one COEP, both ours
    const keys = Object.keys(out).filter((k) => /cross-origin-(opener|embedder)-policy/i.test(k));
    expect(keys).toHaveLength(2);
    expect(out['Cross-Origin-Opener-Policy']).toEqual(['same-origin']);
    expect(out['Cross-Origin-Embedder-Policy']).toEqual(['credentialless']);
    expect(out['content-type']).toEqual(['text/html']);
  });

  it('handles undefined response headers', () => {
    expect(withCrossOriginIsolation(undefined)).toEqual(CROSS_ORIGIN_ISOLATION_HEADERS);
  });
});
