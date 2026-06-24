import { describe, it, expect } from 'vitest';
import { isSafeNavigation } from './navigation';

const DEV = 'http://localhost:5173/index.html';
const FILE = 'file:///Applications/Roro.app/Contents/renderer/main_window/index.html';

describe('isSafeNavigation', () => {
  it('allows same-origin dev-server navigation (incl. hash/query routes)', () => {
    expect(isSafeNavigation('http://localhost:5173/index.html', DEV)).toBe(true);
    expect(isSafeNavigation('http://localhost:5173/#/x', DEV)).toBe(true);
    expect(isSafeNavigation('http://localhost:5173/other?q=1', DEV)).toBe(true);
  });

  it('blocks cross-origin navigation from the dev server', () => {
    expect(isSafeNavigation('https://evil.example/', DEV)).toBe(false);
    expect(isSafeNavigation('http://localhost:9999/', DEV)).toBe(false);
    expect(isSafeNavigation('https://api.external.example/', DEV)).toBe(false);
  });

  it('allows file:// navigation within the packaged app dir', () => {
    expect(isSafeNavigation(FILE, FILE)).toBe(true);
    expect(isSafeNavigation(FILE + '#/settings', FILE)).toBe(true);
  });

  it('blocks file:// escape outside the app dir', () => {
    expect(isSafeNavigation('file:///etc/passwd', FILE)).toBe(false);
    expect(isSafeNavigation('file:///Applications/Roro.app/Contents/other/x.html', FILE)).toBe(false);
  });

  it('blocks remote schemes, javascript:, and garbage', () => {
    expect(isSafeNavigation('https://meet.remote.example/room', FILE)).toBe(false);
    expect(isSafeNavigation('javascript:alert(1)', DEV)).toBe(false);
    expect(isSafeNavigation('data:text/html,<script>1</script>', DEV)).toBe(false);
    expect(isSafeNavigation('not a url', DEV)).toBe(false);
    expect(isSafeNavigation(DEV, 'also not a url')).toBe(false);
  });
});
