// scripts/build-release.mjs — the release/cohort build (the DEFAULT distribution path).
//
// `npm run make` (the documented Developer-ID release path + CI) and `package:release` route here, so a
// distribution build is ALWAYS guarded — it can't be bypassed by forgetting a special command. Two things
// a release build does that a dev/smoke build must not:
//   1. Bake RORO_BUILD_CHANNEL=release so the in-binary guard (src/shared/releaseChannel.ts) refuses every
//      deferred-v0 flag at runtime.
//   2. STRIP the deferred-v0 env set BEFORE packaging, so no package-time gate can read a deferred flag.
//      (Voice needs no stripping anymore: its deps, staging, and forge asset gates all moved to
//      packages/voice, outside the app's dependency graph — a voice payload can't enter this build.)
//
// We run electron-forge DIRECTLY (not `npm run make`, which IS this script → infinite recursion).
//
// Usage: node scripts/build-release.mjs <package|make|publish>
import { spawnSync } from 'node:child_process';
import { stripV0DeferredEnv } from './v0-deferred-env.mjs';

const sub = process.argv[2];
if (sub !== 'package' && sub !== 'make' && sub !== 'publish') {
  console.error('usage: node scripts/build-release.mjs <package|make|publish>');
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
run('npx', ['electron-forge', sub, ...forgeArgs]);
