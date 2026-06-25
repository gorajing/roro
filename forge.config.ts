import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { macSigningConfig, MAC_NATIVE_UNPACK_GLOB } from './src/build/macSigning';

const config: ForgeConfig = {
  packagerConfig: {
    // asar bundles the app, but native LIBRARIES must stay on disk for dlopen. The unpack glob covers
    // sharp's libvips .dylib (a separate package the AutoUnpackNatives plugin's .node-only glob misses);
    // forge merges this with the plugin's .node glob so BOTH the addon and its .dylib land unpacked.
    asar: { unpack: MAC_NATIVE_UNPACK_GLOB },
    // The mic usage string the OS shows on first voice capture. REQUIRED: a hardened-runtime app that
    // touches the microphone without it crashes (pairs with the audio-input entitlement).
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Roro listens only while you hold to talk, and transcribes your speech on-device.',
    },
    // macOS code signing + notarization — gated on the Apple creds being present in the environment
    // (no creds -> unsigned dev/CI build keeps working; partial creds -> fail loud). See src/build/macSigning.ts.
    ...macSigningConfig(process.env),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
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
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
