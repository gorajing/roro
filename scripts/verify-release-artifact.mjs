// scripts/verify-release-artifact.mjs - packaged release artifact verifier.
//
// v0 ships the typed remembering companion. Real on-device voice remains an opt-in/dev surface, so default
// packages must not silently include stale generated VAD/ORT/model payloads from public/.
//
// Run after `npm run package`: npm run verify:release-artifact

import { execFileSync, spawnSync } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
if (!['default', 'signed'].includes(mode)) {
  console.error(`[verify] unsupported mode: ${mode}`);
  console.error('[verify] currently supported: --mode default, --mode signed');
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
if (mode === 'signed' && process.platform !== 'darwin') {
  console.error('[verify] signed artifact verification requires macOS codesign/spctl/stapler.');
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
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceIcon = join(repoRoot, 'assets', 'roro-icon.icns');
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

function iconResourceFilename(rawIconFile) {
  if (typeof rawIconFile !== 'string' || rawIconFile.length === 0) return null;
  return rawIconFile.endsWith('.icns') ? rawIconFile : `${rawIconFile}.icns`;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error((output || result.error?.message || `${command} exited ${result.status}`).trim());
  }
  return output;
}

check('Roro.app exists', await exists(appPath), appPath);
check('Roro binary exists', await exists(binaryPath), binaryPath);
check('app.asar exists', await exists(appAsar), appAsar);
check('Info.plist exists', await exists(infoPlist), infoPlist);
check('source Roro icon exists', await exists(sourceIcon), sourceIcon);

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

    const rawIconFile = info.CFBundleIconFile;
    const iconFile = iconResourceFilename(rawIconFile);
    const iconFileIsLocal =
      typeof iconFile === 'string' && iconFile.length > 0 && !/[\\/]/.test(iconFile) && !iconFile.includes('..');
    check('bundle icon is set', typeof rawIconFile === 'string' && rawIconFile.length > 0);
    check('bundle icon is Roro branded', iconFile === 'roro-icon.icns', `CFBundleIconFile=${rawIconFile ?? '<missing>'}`);
    check('bundle icon is a Resources-local filename', iconFileIsLocal, iconFile ?? '<missing>');

    if (iconFileIsLocal) {
      const iconPath = join(resourcesPath, iconFile);
      const iconExists = await exists(iconPath);
      check(`Resources/${iconFile} exists`, iconExists, iconPath);

      if (iconExists) {
        const iconStats = await stat(iconPath);
        check(`Resources/${iconFile} is non-empty`, iconStats.size > 0, `${iconStats.size} bytes`);
        try {
          const [sourceBytes, bundledBytes] = await Promise.all([readFile(sourceIcon), readFile(iconPath)]);
          check(`Resources/${iconFile} matches source icon`, bundledBytes.equals(sourceBytes));
        } catch (err) {
          check(`Resources/${iconFile} matches source icon`, false, err.message);
        }
        try {
          const iconInfo = execFileSync('sips', ['-g', 'format', iconPath], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          check(`Resources/${iconFile} is an icns`, iconInfo.includes('format: icns'));
        } catch (err) {
          check(`Resources/${iconFile} is an icns`, false, err.stderr?.toString().trim() || err.message);
        }
      }
    }
  } catch (err) {
    check('Info.plist release metadata is readable', false, err.stderr?.toString().trim() || err.message);
  }

  if (mode === 'signed') {
    try {
      const codeSignInfo = commandOutput('codesign', ['-dv', '--verbose=4', appPath]);
      check('signature is Developer ID Application', /Authority=Developer ID Application:/.test(codeSignInfo));
      check('signature is not ad-hoc', !/Signature=adhoc/i.test(codeSignInfo));
      check('hardened runtime is enabled', /Runtime Version=/.test(codeSignInfo));

      const requestedTeamId = process.env.APPLE_TEAM_ID?.trim();
      const teamMatch = /TeamIdentifier=([A-Z0-9]+)/.exec(codeSignInfo);
      check('signed artifact has a TeamIdentifier', Boolean(teamMatch), codeSignInfo);
      if (requestedTeamId) {
        check(
          `signed artifact TeamIdentifier matches APPLE_TEAM_ID=${requestedTeamId}`,
          teamMatch?.[1] === requestedTeamId,
          teamMatch?.[1] ? `TeamIdentifier=${teamMatch[1]}` : 'missing TeamIdentifier',
        );
      }
    } catch (err) {
      check('signed codesign metadata is readable', false, err.message);
    }

    try {
      commandOutput('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
      check('Gatekeeper assessment accepts the app', true);
    } catch (err) {
      check('Gatekeeper assessment accepts the app', false, err.message);
    }

    try {
      commandOutput('xcrun', ['stapler', 'validate', appPath]);
      check('notarization ticket is stapled/valid', true);
    } catch (err) {
      check('notarization ticket is stapled/valid', false, err.message);
    }
  }
}

if (failures.length) {
  const summary =
    mode === 'signed'
      ? 'signed release artifact is not Developer-ID signed/notarized'
      : 'default release artifact is not v0-clean';
  console.error(`\n[verify] FAILED - ${summary}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const passSummary =
  mode === 'signed'
    ? 'signed release artifact is Developer-ID signed/notarized and structurally complete'
    : 'default release artifact is typed-only and structurally complete';
console.log(`\n[verify] PASS - ${passSummary}.`);
