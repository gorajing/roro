// src/build/macSigning.ts — env-gated macOS code-signing + notarization config for forge.config.ts.
//
// Why a helper instead of inlining `osxSign: {}` in forge.config.ts: an unconditional osxSign makes
// `electron-forge make` FAIL on any machine without a Developer ID identity in its keychain — i.e.
// every dev box and the current CI. So signing has to be gated on the Apple creds being present:
//   - all three creds present  -> sign (hardened runtime + our entitlements) + notarize via notarytool
//   - no creds present         -> no signing config (the unsigned dev/CI `make` keeps working as today)
//   - SOME but not all present -> throw (fail loud): a half-configured signer that silently ships an
//                                 UNSIGNED build is exactly the kind of quiet degrade we refuse.
//
// The API shape (osxSign.optionsForFile -> {hardenedRuntime, entitlements}; osxNotarize.tool:'notarytool'
// + appleId/appleIdPassword/teamId) is the current @electron/osx-sign + @electron/notarize contract used
// by Electron Forge 7.x, per the official electronjs.org packaging/code-signing docs.

/** Path (relative to the repo root, where forge runs) to the hardened-runtime entitlements. */
export const MAC_ENTITLEMENTS_PATH = 'build/entitlements.mac.plist';

// asar.unpack glob for native LIBRARIES that must live on disk (not sealed in app.asar) so dlopen can
// find them. The AutoUnpackNativesPlugin only unpacks `*.node` addons — but sharp 0.35 splits its real
// engine into a SEPARATE package as a `.dylib` (@img/sharp-libvips-*/lib/libvips-cpp.*.dylib), which the
// addon resolves via @rpath into the unpacked sibling tree. If that .dylib stays inside the asar, the
// first sharp() call (src/vision/index.ts) crashes the packaged app — signed or not. So we additionally
// unpack `.dylib` files; forge merges this with the plugin's `.node` glob. (Mirrors the plugin's pattern
// shape so native libs in hidden dep dirs are covered too.)
export const MAC_NATIVE_UNPACK_GLOB = '**/{.**,**}/**/*.dylib';

/** The three env vars that together enable signing+notarization. */
const APPLE_CRED_VARS = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'] as const;

/** Which of the Apple cred vars are non-empty (an unset CI secret exports as "", which counts as absent).
 *  Shared by the config + the preflight so their "is signing requested?" gating can never drift apart. */
function presentCreds(env: Record<string, string | undefined>): readonly string[] {
  return APPLE_CRED_VARS.filter((name) => (env[name] ?? '').trim() !== '');
}

export interface MacSigning {
  osxSign?: {
    optionsForFile: (filePath: string) => { hardenedRuntime: boolean; entitlements: string };
  };
  osxNotarize?: {
    tool: 'notarytool';
    appleId: string;
    appleIdPassword: string;
    teamId: string;
  };
}

/** Build the osxSign/osxNotarize slice of packagerConfig from the environment. Pure + fail-loud. */
export function macSigningConfig(env: Record<string, string | undefined>): MacSigning {
  const present = presentCreds(env);

  if (present.length === 0) return {}; // unsigned: dev + current CI `make` keep working

  if (present.length < APPLE_CRED_VARS.length) {
    const missing = APPLE_CRED_VARS.filter((name) => !present.includes(name));
    throw new Error(
      `macOS signing is partially configured — set or unset ALL of ${APPLE_CRED_VARS.join(', ')}. ` +
        `Missing: ${missing.join(', ')}. (Refusing to ship a silently-unsigned build.)`,
    );
  }

  return {
    osxSign: {
      // One superset entitlements file signed onto the app AND every Helper, with the hardened runtime on
      // (a notarization requirement). This is the documented Electron Forge pattern and is known to work.
      // Accepted tradeoff: the GPU/Network helpers receive entitlements they never exercise (e.g.
      // disable-library-validation, audio-input) — a small residual relaxation of the hardened runtime on
      // those processes. Splitting into per-process plists would tighten it, but reliably matching each
      // Helper bundle by path is Electron-version-fragile and unverifiable without a signed on-device run,
      // so we keep the safe superset. (M6b review P3 — revisit if/when per-process signing is verifiable.)
      optionsForFile: () => ({ hardenedRuntime: true, entitlements: MAC_ENTITLEMENTS_PATH }),
    },
    osxNotarize: {
      tool: 'notarytool',
      appleId: env.APPLE_ID!.trim(),
      appleIdPassword: env.APPLE_PASSWORD!.trim(),
      teamId: env.APPLE_TEAM_ID!.trim(),
    },
  };
}

/**
 * Fail EARLY and CLEARLY when signing is requested but the keychain can't satisfy it. Without this,
 * `electron-forge make` with the env vars set but no Developer ID cert dies deep inside codesign with
 * "code has no resources but signature indicates they must be present" + a 30-line dump — which gives a
 * first-timer no idea the real cause is a missing/ wrong-type certificate.
 *
 * Only runs when full signing is requested (all 3 creds present); partial creds are macSigningConfig's
 * error, and the unsigned path never reaches the keychain. `listCodesignIdentities` is injected (the
 * output of `security find-identity -v -p codesigning`) so this stays pure + testable off a real Mac.
 */
export function assertSigningIdentity(
  env: Record<string, string | undefined>,
  listCodesignIdentities: () => string,
): void {
  if (presentCreds(env).length < APPLE_CRED_VARS.length) return; // not (fully) requested — nothing to check

  // osx-sign signs with a "Developer ID Application" identity for outside-the-store distribution. An
  // "Apple Development" cert (the free/local-dev type) is NOT enough and yields an ad-hoc signature. Match
  // with the trailing colon to mirror osx-sign's own identity predicate exactly (security find-identity
  // always prints "Developer ID Application: Name (TEAM)").
  if (!listCodesignIdentities().includes('Developer ID Application:')) {
    throw new Error(
      'macOS signing is configured (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID are set), but no ' +
        '"Developer ID Application" certificate was found in your keychain. Roro signs with a Developer ID ' +
        'cert for distribution — an "Apple Development" cert is not enough. Check with ' +
        '`security find-identity -v -p codesigning`, create a Developer ID Application certificate (needs ' +
        'the paid Apple Developer Program), or `unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID` to build unsigned.',
    );
  }
}
