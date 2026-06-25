import { describe, it, expect } from 'vitest';
import { isAllowedExternalUrl } from './openExternalGuard';

// shell.openExternal is a classic Electron foot-gun (file://, custom schemes, phishing). Roro opens exactly
// ONE external place — the Ollama download page — so the allowlist is https + ollama.com (incl subdomains).

describe('isAllowedExternalUrl', () => {
  it('allows https ollama.com (and its subdomains)', () => {
    expect(isAllowedExternalUrl('https://ollama.com/download')).toBe(true);
    expect(isAllowedExternalUrl('https://ollama.com')).toBe(true);
    expect(isAllowedExternalUrl('https://www.ollama.com/library')).toBe(true);
  });

  it('rejects non-https (no http downgrade)', () => {
    expect(isAllowedExternalUrl('http://ollama.com/download')).toBe(false);
  });

  it('rejects look-alike + suffix-attack hosts', () => {
    expect(isAllowedExternalUrl('https://ollama.com.evil.com/x')).toBe(false); // suffix attack
    expect(isAllowedExternalUrl('https://evilollama.com')).toBe(false); // prefix attack
    expect(isAllowedExternalUrl('https://notollama.com')).toBe(false);
  });

  it('rejects dangerous schemes + garbage', () => {
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl('')).toBe(false);
  });
});
