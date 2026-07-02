import { defineConfig } from 'vite';

// @anthropic-ai/claude-agent-sdk (exact pin, ESM-only) is bundled STATICALLY into the main bundle
// by the forge-vite defaults (only electron + node builtins are external), landing as a CJS chunk
// beside main.js in .vite/build — no node_modules shipping, no new asar-unpack globs. The SDK's
// own platform-binary resolution (createRequire of @anthropic-ai/claude-agent-sdk-darwin-*) is
// DEAD CODE in roro: the adapter always passes pathToClaudeCodeExecutable (the user's installed
// CLI via resolveBin), so the 229MB bundled-binary optionalDependency never ships nor resolves.
// Proven by `npm run package` + verify:release-artifact and the packaged SDK smoke
// (docs/plans/sdk-executor.md, C2/C6).

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
