// scripts/build-release.mjs — the release/cohort build (the DEFAULT distribution path).
//
// `npm run make` (the documented Developer-ID release path + CI) and `package:release` route here, so a
// distribution build is ALWAYS guarded — it can't be bypassed by forgetting a special command. Two things
// a release build does that a dev/smoke build must not:
//   1. Bake RORO_BUILD_CHANNEL=release so the in-binary guard (src/shared/releaseChannel.ts) refuses every
//      deferred-v0 flag at runtime.
//   2. STRIP the deferred-v0 env set BEFORE packaging, so forge.config.ts's package-time asset gates
//      (which read RORO_*_VOICE / LIVE2D_MODEL_URL) cannot bundle a voice/Live2D payload the runtime would
//      only refuse — otherwise the release artifact ships dead deferred payload.
//
// We run electron-forge DIRECTLY (not `npm run make`, which IS this script → infinite recursion) and run
// the asset-staging step explicitly first, with the stripped env, so it stages nothing. (The npm `premake`
// hook is intentionally removed for the same reason: it would stage with the UN-stripped env before us.)
//
// Usage: node scripts/build-release.mjs <package|make>
import { spawnSync } from 'node:child_process';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const sub = process.argv[2];
if (sub !== 'package' && sub !== 'make') {
  console.error('usage: node scripts/build-release.mjs <package|make>');
  process.exit(2);
}

const env = stripV0DeferredEnv({ ...process.env });
env.RORO_BUILD_CHANNEL = 'release';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.error) {
    console.error(`[build-release] failed to spawn ${cmd}:`, r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Forward any extra Forge args transparently (e.g. `npm run make -- --arch=x64 --platform=darwin`).
const forgeArgs = process.argv.slice(3);
console.log(`[build-release] electron-forge ${[sub, ...forgeArgs].join(' ')} on the RELEASE channel — deferred-v0 env stripped.`);
run('node', ['scripts/stage-voice-assets.mjs']); // staging, explicit (stages nothing — env is stripped)
run('npx', ['electron-forge', sub, ...forgeArgs]);
