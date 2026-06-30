import { defineConfig } from 'vite';

// The release/cohort build sets RORO_BUILD_CHANNEL=release (npm run make:release / package:release);
// dev + the packaged smokes leave it unset → 'dev'. Frozen into the MAIN bundle via `define` so NO
// launch-time env (.env, exported var, argv) can flip it on a shipped build. Consumed by
// src/shared/releaseChannel.ts, which refuses every deferred-v0 flag on the release channel.
const BUILD_CHANNEL = process.env.RORO_BUILD_CHANNEL === 'release' ? 'release' : 'dev';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    __RORO_BUILD_CHANNEL__: JSON.stringify(BUILD_CHANNEL),
  },
});
