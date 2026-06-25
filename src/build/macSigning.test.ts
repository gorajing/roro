import { describe, it, expect } from 'vitest';

import { macSigningConfig, MAC_ENTITLEMENTS_PATH, MAC_NATIVE_UNPACK_GLOB } from './macSigning';

// minimatch 3.x (the exact matcher @electron/asar uses to apply the unpack glob) is CommonJS with no
// bundled types — require + annotate so this regression test matches files the way the packer will.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const minimatch = require('minimatch') as (target: string, pattern: string) => boolean;

// The gating contract for macOS signing in forge.config.ts. Signing MUST NOT be unconditional:
// `osxSign: {}` fails `electron-forge make` on any machine without a Developer ID cert (every dev
// box + the current CI). So this pure helper turns env into config: full creds -> sign+notarize,
// no creds -> unsigned (dev build still works), PARTIAL creds -> throw (a half-configured signer
// silently shipping an UNSIGNED build is the trap we fail loud to avoid).

const FULL = {
  APPLE_ID: 'dev@example.com',
  APPLE_PASSWORD: 'app-specific-pw',
  APPLE_TEAM_ID: 'ABCDE12345',
};

describe('macSigningConfig', () => {
  it('returns no signing config when NO Apple creds are present (dev/unsigned make still works)', () => {
    const cfg = macSigningConfig({});
    expect(cfg.osxSign).toBeUndefined();
    expect(cfg.osxNotarize).toBeUndefined();
  });

  it('treats empty-string env vars as absent (CI exports an unset secret as "")', () => {
    const cfg = macSigningConfig({ APPLE_ID: '', APPLE_PASSWORD: '', APPLE_TEAM_ID: '' });
    expect(cfg.osxSign).toBeUndefined();
    expect(cfg.osxNotarize).toBeUndefined();
  });

  it('returns notarytool notarize config wired to the three creds when ALL are present', () => {
    const cfg = macSigningConfig(FULL);
    expect(cfg.osxNotarize).toEqual({
      tool: 'notarytool',
      appleId: 'dev@example.com',
      appleIdPassword: 'app-specific-pw',
      teamId: 'ABCDE12345',
    });
  });

  it('enables hardened runtime + our entitlements for every file when signing', () => {
    const cfg = macSigningConfig(FULL);
    expect(cfg.osxSign).toBeDefined();
    const perFile = cfg.osxSign!.optionsForFile('/any/Helper (GPU).app');
    expect(perFile).toEqual({ hardenedRuntime: true, entitlements: MAC_ENTITLEMENTS_PATH });
  });

  it('throws (fail loud) when creds are PARTIAL — names every missing var', () => {
    expect(() => macSigningConfig({ APPLE_ID: 'dev@example.com' })).toThrowError(
      /APPLE_PASSWORD.*APPLE_TEAM_ID|APPLE_TEAM_ID.*APPLE_PASSWORD/,
    );
  });

  it('throws naming the single missing var when only one is absent', () => {
    expect(() =>
      macSigningConfig({ APPLE_ID: 'dev@example.com', APPLE_PASSWORD: 'pw' }),
    ).toThrowError(/APPLE_TEAM_ID/);
  });
});

describe('MAC_NATIVE_UNPACK_GLOB (sharp/libvips crash regression)', () => {
  // sharp 0.35 ships libvips as a SEPARATE-package .dylib that the AutoUnpackNatives plugin's .node-only
  // glob misses; left in the asar, the first sharp() call crashes the packaged app. The unpack glob MUST
  // keep matching that .dylib. (Glob-match assertion, not a filesystem probe: CI is Linux where sharp
  // ships .so, so reading node_modules/@img would be platform-fragile.)
  it('matches the libvips .dylib path so it is unpacked out of the asar', () => {
    const libvips = 'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.3.dylib';
    expect(minimatch(libvips, MAC_NATIVE_UNPACK_GLOB)).toBe(true);
  });

  it('does not over-match ordinary bundled JS', () => {
    expect(minimatch('node_modules/@img/sharp/lib/index.js', MAC_NATIVE_UNPACK_GLOB)).toBe(false);
  });
});
