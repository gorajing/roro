import { describe, it, expect, vi } from 'vitest';

import {
  macSigningConfig,
  MAC_ENTITLEMENTS_PATH,
  MAC_NATIVE_UNPACK_GLOB,
  assertSigningIdentity,
} from './macSigning';

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
  it('returns no Developer-ID config when NO Apple creds are present (the postPackage hook ad-hoc re-seals)', () => {
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

describe('assertSigningIdentity (clear preflight instead of a cryptic codesign dump)', () => {
  const FULL = {
    APPLE_ID: 'dev@example.com',
    APPLE_PASSWORD: 'app-specific-pw',
    APPLE_TEAM_ID: 'ABCDE12345',
  };
  // What `security find-identity -v -p codesigning` prints when only the free local-dev cert exists —
  // the EXACT situation that produced the "code has no resources but signature indicates..." failure.
  const ONLY_APPLE_DEV =
    '  1) 606C...66B "Apple Development: dev@example.com (9D9FQ9D5DT)"\n     1 valid identities found';
  const HAS_DEVELOPER_ID =
    '  1) ABC1...23F "Developer ID Application: Dev Name (ABCDE12345)"\n     1 valid identities found';

  it('does NOT touch the keychain when signing is not requested (unsigned dev/CI build)', () => {
    const list = vi.fn(() => '');
    expect(() => assertSigningIdentity({}, list)).not.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  it('does NOT touch the keychain when creds are only partial (macSigningConfig owns that error)', () => {
    const list = vi.fn(() => '');
    expect(() => assertSigningIdentity({ APPLE_ID: 'dev@example.com' }, list)).not.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  it('passes when a Developer ID Application identity is present', () => {
    expect(() => assertSigningIdentity(FULL, () => HAS_DEVELOPER_ID)).not.toThrow();
  });

  it('throws a CLEAR, actionable error when only an Apple Development cert exists', () => {
    expect(() => assertSigningIdentity(FULL, () => ONLY_APPLE_DEV)).toThrowError(
      /Developer ID Application/,
    );
    // the message must point at both escape hatches: how to check, and how to build unsigned
    expect(() => assertSigningIdentity(FULL, () => ONLY_APPLE_DEV)).toThrowError(
      /security find-identity[\s\S]*unset|unset[\s\S]*security find-identity/,
    );
  });

  it('throws when the keychain has no code-signing identities at all', () => {
    expect(() => assertSigningIdentity(FULL, () => '')).toThrowError(/Developer ID Application/);
  });
});
