import { describe, it, expect } from 'vitest';
import { resolveWorkdir } from './workdir';

// The coding agent edits files on disk, so "which repo?" is a SAFETY decision. The old default silently
// fell back to process.cwd() — which, in a packaged app, is the app bundle / the user's home, and running
// from source is roro's OWN checkout. So an unchosen repo must FAIL LOUD, not silently mutate the wrong tree.

describe('resolveWorkdir — fail-loud repo selection', () => {
  it('returns RORO_WORKDIR when set (the chosen project)', () => {
    expect(resolveWorkdir({ RORO_WORKDIR: '/home/dev/myrepo' }, '/anything')).toBe('/home/dev/myrepo');
  });

  it('REFUSES (throws) when no repo is chosen — never silently edits cwd', () => {
    expect(() => resolveWorkdir({}, '/Applications/Roro.app')).toThrow(/no working repo/i);
  });

  it('treats a blank/whitespace RORO_WORKDIR as unset (throws)', () => {
    expect(() => resolveWorkdir({ RORO_WORKDIR: '   ' }, '/cwd')).toThrow(/no working repo/i);
  });

  it('allows cwd ONLY with the explicit RORO_ALLOW_CWD=1 dev opt-in', () => {
    expect(resolveWorkdir({ RORO_ALLOW_CWD: '1' }, '/cwd')).toBe('/cwd');
  });

  it('a chosen RORO_WORKDIR takes precedence over the cwd opt-in', () => {
    expect(resolveWorkdir({ RORO_WORKDIR: '/repo', RORO_ALLOW_CWD: '1' }, '/cwd')).toBe('/repo');
  });
});
