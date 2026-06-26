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
export const APPLE_CRED_VARS = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'] as const;
export type AppleCredVar = (typeof APPLE_CRED_VARS)[number];

export interface AppleSigningEnvStatus {
  present: readonly AppleCredVar[];
  missing: readonly AppleCredVar[];
  isPartial: boolean;
  isComplete: boolean;
}

/** Which Apple signing env vars are non-empty. Empty CI secrets count as absent. */
export function appleSigningEnvStatus(env: Record<string, string | undefined>): AppleSigningEnvStatus {
  const present = APPLE_CRED_VARS.filter((name) => (env[name] ?? '').trim() !== '');
  const missing = APPLE_CRED_VARS.filter((name) => !present.includes(name));
  return {
    present,
    missing,
    isPartial: present.length > 0 && present.length < APPLE_CRED_VARS.length,
    isComplete: present.length === APPLE_CRED_VARS.length,
  };
}

/** Shared by the config + preflights so their "is signing requested?" gating cannot drift apart. */
function presentCreds(env: Record<string, string | undefined>): readonly AppleCredVar[] {
  return appleSigningEnvStatus(env).present;
}

export interface DeveloperIdApplicationIdentity {
  hash: string;
  name: string;
  teamId: string;
  raw: string;
}

/**
 * Parse `security find-identity -v -p codesigning` output for distribution certs.
 * Apple Development certs are intentionally ignored; they cannot notarize an outside-the-store app.
 */
export function developerIdApplicationIdentities(output: string): DeveloperIdApplicationIdentity[] {
  const identities: DeveloperIdApplicationIdentity[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"Developer ID Application:\s+(.+)\s+\(([A-Z0-9]+)\)"\s*$/.exec(raw);
    if (!match) continue;
    identities.push({
      hash: match[1],
      name: match[2],
      teamId: match[3],
      raw,
    });
  }
  return identities;
}

export function hasDeveloperIdApplicationIdentity(output: string, teamId?: string): boolean {
  const trimmedTeamId = teamId?.trim();
  const identities = developerIdApplicationIdentities(output);
  if (!trimmedTeamId) return identities.length > 0;
  return identities.some((identity) => identity.teamId === trimmedTeamId);
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

  // NO Apple creds: no Developer-ID osxSign/notarize config. The packaged build is still made VALID by a
  // final AD-HOC re-seal in forge.config's postPackage hook — required because forge's fuse flip + extendInfo
  // Info.plist rewrite otherwise leave the seal STALE, and macOS Keychain rejects an invalidly-signed app
  // (errSecAuthFailed → safeStorage false → encrypted memory can't persist). No cert needed. CAVEAT: an ad-hoc
  // cdhash changes every build, so memory persists only WITHIN one build (quit/relaunch) — across rebuilds the
  // keychain ACL no longer matches; the Developer-ID build (stable team identity) is what survives updates.
  if (present.length === 0) return {};

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
 * Electron's cookie-encryption fuse can touch the macOS Keychain while Chromium opens the user profile,
 * before Roro's main-process JS has logged or created a renderer. Ad-hoc builds get a new cdhash on every
 * package, so stale Keychain ACLs from the previous build can make that pre-JS path hang on an old profile.
 *
 * Cookies are not product state in Roro. Keep the fuse off for ad-hoc dev/CI packages, and only enable it
 * when Developer-ID signing gives the app a stable identity across updates. Encrypted memory-at-rest remains
 * owned by src/memory2's safeStorage key wrapper and still fails loud at the memory call site.
 */
export function shouldEnableCookieEncryption(signing: MacSigning): boolean {
  return Boolean(signing.osxSign);
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
  const output = listCodesignIdentities();
  const identities = developerIdApplicationIdentities(output);
  if (identities.length === 0) {
    throw new Error(
      'macOS signing is configured (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID are set), but no ' +
        '"Developer ID Application" certificate was found in your keychain. Roro signs with a Developer ID ' +
        'cert for distribution — an "Apple Development" cert is not enough. Check with ' +
        '`security find-identity -v -p codesigning`, create a Developer ID Application certificate (needs ' +
        'the paid Apple Developer Program), or `unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID` to build unsigned.',
    );
  }

  const teamId = env.APPLE_TEAM_ID?.trim();
  if (teamId && !hasDeveloperIdApplicationIdentity(output, teamId)) {
    throw new Error(
      `macOS signing is configured for APPLE_TEAM_ID=${teamId}, but no matching "Developer ID Application" ` +
        `certificate was found in your keychain. Found Developer ID team(s): ${identities.map((id) => id.teamId).join(', ')}. ` +
        'Use the team id from `security find-identity -v -p codesigning`, or install the matching Developer ID Application certificate.',
    );
  }
}
