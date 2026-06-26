// scripts/verify-release-artifact.mjs - packaged release artifact verifier.
//
// v0 ships the typed remembering companion. Real on-device voice remains an opt-in/dev surface, so default
// packages must not silently include stale generated VAD/ORT/model payloads from public/.
//
// Run after `npm run package`: npm run verify:release-artifact

import { execFileSync } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { listPackage } from '@electron/asar';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=', 2);
  const value = inlineValue ?? (process.argv[i + 1]?.startsWith('--') ? undefined : process.argv[++i]);
  args.set(key, value ?? 'true');
}

const mode = args.get('mode') ?? 'default';
if (mode !== 'default') {
  console.error(`[verify] unsupported mode: ${mode}`);
  console.error('[verify] currently supported: --mode default');
  process.exit(1);
}

if (
  process.env.RORO_VAD_VOICE === '1' ||
  process.env.RORO_STT_VOICE === '1' ||
  process.env.RORO_TTS_VOICE === '1'
) {
  console.error('[verify] default release artifact verification requires a typed-only v0 build.');
  console.error('[verify] unset RORO_VAD_VOICE/RORO_STT_VOICE/RORO_TTS_VOICE, rebuild, and rerun.');
  process.exit(1);
}

if (process.platform !== 'darwin' && !args.get('app')) {
  console.error('[verify] default app path targets the darwin .app bundle.');
  console.error('[verify] set --app /absolute/path/to/Roro.app to inspect another packaged app.');
  process.exit(1);
}

const appPath = resolve(
  args.get('app') ||
    `out/Roro-darwin-${process.arch}/Roro.app`,
);
const binaryPath = join(appPath, 'Contents', 'MacOS', 'Roro');
const resourcesPath = join(appPath, 'Contents', 'Resources');
const appAsar = join(resourcesPath, 'app.asar');
const infoPlist = join(appPath, 'Contents', 'Info.plist');
const failures = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  fail ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(name);
  }
}

function plistJson() {
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

check('Roro.app exists', await exists(appPath), appPath);
check('Roro binary exists', await exists(binaryPath), binaryPath);
check('app.asar exists', await exists(appAsar), appAsar);
check('Info.plist exists', await exists(infoPlist), infoPlist);

if (failures.length) {
  console.error(`\n[verify] FAILED - packaged app is incomplete.`);
  process.exit(1);
}

const files = listPackage(appAsar);
const fileSet = new Set(files);
const required = [
  '/.vite/build/main.js',
  '/.vite/build/preload.js',
  '/.vite/renderer/main_window/index.html',
];
for (const file of required) check(`asar includes ${file}`, fileSet.has(file));

const forbidden = [
  {
    label: 'Silero VAD runtime',
    prefix: '/.vite/renderer/main_window/vad',
  },
  {
    label: 'transformers ORT runtime',
    prefix: '/.vite/renderer/main_window/ort',
  },
  {
    label: 'voice/STT/TTS model weights',
    prefix: '/.vite/renderer/main_window/models',
  },
  {
    label: 'voice dynamic chunks',
    prefix: '/.vite/renderer/main_window/assets/',
    pattern: /\/(?:sileroVad|whisperTranscribe|kokoroSynthesize|kokoroVoiceEngine|onnxRuntimeEnv)-.*\.js$|\/ort-wasm-simd-threaded\.jsep-.*\.wasm$/,
  },
];

for (const item of forbidden) {
  const matches = files.filter((file) => {
    if (item.pattern) return file.startsWith(item.prefix) && item.pattern.test(file);
    return file === item.prefix || file.startsWith(`${item.prefix}/`);
  });
  if (matches.length) {
    failures.push(`${item.label}: ${matches.slice(0, 5).join(', ')}${matches.length > 5 ? ` (+${matches.length - 5} more)` : ''}`);
  } else {
    console.log(`  ok ${item.label} absent from default release artifact`);
  }
}

const asarStats = await stat(appAsar);
check('default app.asar is under 200 MB', asarStats.size < 200_000_000, `${asarStats.size} bytes`);

if (process.platform === 'darwin') {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    check('codesign verifies', true);
  } catch (err) {
    check('codesign verifies', false, err.stderr?.toString().trim() || err.message);
  }

  try {
    const info = plistJson();
    check('bundle identifier is com.jinchoi.roro', info.CFBundleIdentifier === 'com.jinchoi.roro');
    check('bundle name is Roro', info.CFBundleName === 'Roro');
    check('microphone usage string is present', info.NSMicrophoneUsageDescription?.includes('Roro listens'));
    check('asar integrity is present', info.ElectronAsarIntegrity?.['Resources/app.asar']?.algorithm === 'SHA256');
  } catch (err) {
    check('Info.plist release metadata is readable', false, err.stderr?.toString().trim() || err.message);
  }
}

if (failures.length) {
  console.error(`\n[verify] FAILED - default release artifact is not v0-clean:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\n[verify] PASS - default release artifact is typed-only and structurally complete.');
