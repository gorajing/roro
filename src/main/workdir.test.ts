import { describe, it, expect } from 'vitest';
import { resolveWorkdir, tryResolveWorkdir } from './workdir';

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

// tryResolveWorkdir is the BEST-EFFORT variant for MEMORY SCOPING: a turn with no chosen repo (answer/clarify,
// or a no-workdir setup) must still recall + remember — just without repo-scoping — so this returns undefined
// instead of throwing. (Editing files still goes through the throwing resolveWorkdir; reading memory is not a
// safety refusal.)
describe('tryResolveWorkdir — best-effort repo for memory scoping (never throws)', () => {
  it('returns RORO_WORKDIR when set', () => {
    expect(tryResolveWorkdir({ RORO_WORKDIR: '/home/dev/myrepo' }, '/anything')).toBe('/home/dev/myrepo');
  });

  it('returns undefined (NOT a throw) when no repo is chosen', () => {
    expect(tryResolveWorkdir({}, '/Applications/Roro.app')).toBeUndefined();
  });

  it('treats a blank RORO_WORKDIR as unset → undefined', () => {
    expect(tryResolveWorkdir({ RORO_WORKDIR: '   ' }, '/cwd')).toBeUndefined();
  });

  it('returns cwd under the RORO_ALLOW_CWD=1 opt-in', () => {
    expect(tryResolveWorkdir({ RORO_ALLOW_CWD: '1' }, '/cwd')).toBe('/cwd');
  });
});
