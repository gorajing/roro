import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { notarize } from '@electron/notarize';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  macSigningConfig,
  MAC_NATIVE_UNPACK_GLOB,
  assertSigningIdentity,
  shouldEnableCookieEncryption,
} from './src/build/macSigning';

const macSigning = macSigningConfig(process.env);
const includeVadAssets =
  process.env.RORO_VAD_VOICE === '1' ||
  process.env.RORO_STT_VOICE === '1' ||
  process.env.RORO_TTS_VOICE === '1';
const includeTransformersOrtAssets =
  process.env.RORO_STT_VOICE === '1' ||
  process.env.RORO_TTS_VOICE === '1';
const includeSttModel = process.env.RORO_STT_VOICE === '1';
const includeTtsModel = process.env.RORO_TTS_VOICE === '1';

function ignorePackagedFile(file: string): boolean {
  if (!file) return false;

  // Preserve the Electron Forge Vite plugin's default copy filter: packaged apps only need .vite.
  if (!file.startsWith('/.vite')) return true;

  // v0 ships typed-only by default. Voice is still available for dev/opt-in builds, but ignored in
  // normal packages so stale generated public/ assets cannot silently bloat the stranger-download app.
  const rendererPrefix = '/.vite/renderer/main_window/';
  if (!file.startsWith(rendererPrefix)) return false;
  const rel = file.slice(rendererPrefix.length);

  if ((rel === 'vad' || rel.startsWith('vad/')) && !includeVadAssets) return true;
  if ((rel === 'ort' || rel.startsWith('ort/')) && !includeTransformersOrtAssets) return true;
  if ((rel === 'models' || rel === 'models/onnx-community') && !includeSttModel && !includeTtsModel) return true;
  if (rel.startsWith('assets/')) {
    const assetName = rel.slice('assets/'.length);
    if (/^sileroVad-.*\.js$/.test(assetName) && !includeVadAssets) return true;
    if (/^whisperTranscribe-.*\.js$/.test(assetName) && !includeSttModel) return true;
    if (/^kokoro(?:Synthesize|VoiceEngine)-.*\.js$/.test(assetName) && !includeTtsModel) return true;
    if (/^onnxRuntimeEnv-.*\.js$/.test(assetName) && !includeTransformersOrtAssets) return true;
    if (/^ort-wasm-simd-threaded\.jsep-.*\.wasm$/.test(assetName) && !includeTransformersOrtAssets) return true;
  }
  if (rel === 'models/onnx-community/whisper-base.en' || rel.startsWith('models/onnx-community/whisper-base.en/')) {
    return !includeSttModel;
  }
  if (
    rel === 'models/onnx-community/Kokoro-82M-v1.0-ONNX' ||
    rel.startsWith('models/onnx-community/Kokoro-82M-v1.0-ONNX/')
  ) {
    return !includeTtsModel;
  }
  return false;
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.jinchoi.roro',
    appCategoryType: 'public.app-category.developer-tools',
    icon: join(__dirname, 'assets', 'roro-icon'),
    ignore: ignorePackagedFile,
    // asar bundles the app, but native LIBRARIES must stay on disk for dlopen. The unpack glob covers
    // sharp's libvips .dylib (a separate package the AutoUnpackNatives plugin's .node-only glob misses);
    // forge merges this with the plugin's .node glob so BOTH the addon and its .dylib land unpacked.
    asar: { unpack: MAC_NATIVE_UNPACK_GLOB },
    // The mic usage string the OS shows on first voice capture. REQUIRED: a hardened-runtime app that
    // touches the microphone without it crashes (pairs with the audio-input entitlement).
    extendInfo: {
      CFBundleIconFile: 'roro-icon.icns',
      NSMicrophoneUsageDescription:
        'Roro listens only after you start Voice Mode, and transcribes your speech on-device.',
    },
    // macOS code signing + notarization — gated on the Apple creds being present in the environment
    // (no creds -> unsigned dev/CI build keeps working; partial creds -> fail loud). See src/build/macSigning.ts.
    ...macSigning,
  },
  rebuildConfig: {},
  hooks: {
    // Before packaging a darwin target, if signing is requested (the Apple env vars are set) verify a
    // Developer ID cert actually exists — otherwise fail NOW with one clear line instead of letting
    // codesign die later with a cryptic "code has no resources..." dump. Only runs on package/make
    // (not `electron-forge start`), and only shells out to `security` when signing is actually requested.
    prePackage: async (_forgeConfig, platform) => {
      if (platform !== 'darwin') return;
      assertSigningIdentity(process.env, () => {
        try {
          // Static args, no shell — execFileSync passes them straight to `security` (no injection surface).
          return execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
        } catch {
          return ''; // `security` unavailable/errored -> treat as no identities; the clear error still applies
        }
      });
    },
    // After packaging, AD-HOC re-seal darwin builds that are NOT Developer-ID-signed. ROOT CAUSE this fixes:
    // forge's fuse flip + the extendInfo Info.plist rewrite leave the signature STALE/invalid, and macOS
    // Keychain REJECTS an invalidly-signed app (errSecAuthFailed) → safeStorage.isEncryptionAvailable() is
    // false → encrypted memory silently can't persist (proven on-device). A final VALID ad-hoc seal (no Apple
    // cert, no keychain prompt) fixes it. The Developer-ID path (creds present → osxSign) signs + notarizes
    // validly already, so we SKIP it — an ad-hoc re-sign would destroy the Developer ID signature. Runs LAST.
    // CAVEAT: ad-hoc cdhash changes per build, so the keychain ACL only matches the SAME build — memory
    // survives quit/relaunch but NOT a rebuild/update (every `npm run package` orphans the prior test corpus).
    // That cross-update stability is exactly what the Developer-ID (stable team identity) build provides.
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      if (macSigning.osxSign) return; // Developer ID build — leave its signature intact
      for (const dir of options.outputPaths) {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(dir, 'Roro.app')], { stdio: 'inherit' });
      }
    },
    // Electron Forge notarizes the .app during package when Developer-ID signing is enabled. The thing strangers
    // download is the DMG made later, so notarize/staple that container too in signed builds.
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform !== 'darwin' || !macSigning.osxNotarize) return makeResults;

      for (const result of makeResults) {
        if (result.platform !== 'darwin') continue;
        for (const artifact of result.artifacts.filter((path) => path.endsWith('.dmg'))) {
          await notarize({
            ...macSigning.osxNotarize,
            appPath: artifact,
          });
        }
      }

      return makeResults;
    },
  },
  // macOS-only product (signing, keychain, entitlements, darwin-only smokes) — no Windows/Linux makers.
  makers: [
    new MakerZIP({}, ['darwin']),
    // The public macOS distribution gate is a downloadable .dmg, not just the basic ZIP archive.
    // Keep the default versioned name (`Roro-<version>-<arch>.dmg`) so release artifacts are traceable.
    new MakerDMG({}, ['darwin']),
  ],
  plugins: [
    // Unpacks `*.node` native addons out of the asar (e.g. sharp's addon). NOTE: this is necessary but
    // NOT sufficient for sharp — its libvips engine is a separate `.dylib`, covered by the asar.unpack
    // glob above. forge merges the two globs.
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      // Cookie encryption opens macOS Keychain from Chromium profile startup, before Roro can create
      // the renderer. Ad-hoc rebuilds have a different cdhash, so stale profile Keychain ACLs can hang
      // that pre-JS path. Roro stores no product state in cookies; memory encryption stays in src/memory2.
      [FuseV1Options.EnableCookieEncryption]: shouldEnableCookieEncryption(macSigning),
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
