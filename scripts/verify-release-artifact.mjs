// scripts/verify-release-artifact.mjs - packaged release artifact verifier.
//
// v0 ships the typed remembering companion. Real on-device voice remains an opt-in/dev surface, so default
// packages must not silently include stale generated VAD/ORT/model payloads from public/.
//
// Run after `npm run package`: npm run verify:release-artifact
// Run after `npm run make`: npm run verify:release-artifact:dmg

import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const requireDmg = args.get('require-dmg') === 'true' || args.get('require-dmg') === '1';
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
const makeRoot = resolve(args.get('make-root') || 'out/make');
const binaryPath = join(appPath, 'Contents', 'MacOS', 'Roro');
const resourcesPath = join(appPath, 'Contents', 'Resources');
const appAsar = join(resourcesPath, 'app.asar');
const infoPlist = join(appPath, 'Contents', 'Info.plist');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const packageVersion = packageMetadata.version;
const sourceIcon = join(repoRoot, 'assets', 'roro-icon.icns');
const failures = [];
const required = [
  '/.vite/build/main.js',
  '/.vite/build/preload.js',
  '/.vite/renderer/main_window/index.html',
];
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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  await walk(root);
  return found;
}

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  fail ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(name);
  }
}

function plistJson(plistPath = infoPlist) {
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function appBundlePaths(candidateAppPath) {
  const candidateResourcesPath = join(candidateAppPath, 'Contents', 'Resources');
  return {
    binaryPath: join(candidateAppPath, 'Contents', 'MacOS', 'Roro'),
    appAsar: join(candidateResourcesPath, 'app.asar'),
    infoPlist: join(candidateAppPath, 'Contents', 'Info.plist'),
  };
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

async function findDmgArtifact() {
  const expected = `Roro-${packageVersion}-${process.arch}.dmg`;
  const expectedPath = resolve(makeRoot, expected);
  const candidates = (await walkFiles(makeRoot))
    .filter((file) => file.endsWith('.dmg'))
    .sort((a, b) => a.localeCompare(b));
  const unexpected = candidates.filter((file) => file !== expectedPath);
  return {
    expected,
    expectedPath,
    candidates,
    unexpected,
    dmgPath: (await exists(expectedPath)) ? expectedPath : null,
  };
}

function verifyCodesign(candidateAppPath, label) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', candidateAppPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    check(`${label} codesign verifies`, true);
  } catch (err) {
    check(`${label} codesign verifies`, false, err.stderr?.toString().trim() || err.message);
  }
}

function verifySignedApp(candidateAppPath, label) {
  try {
    const codeSignInfo = commandOutput('codesign', ['-dv', '--verbose=4', candidateAppPath]);
    check(`${label} signature is Developer ID Application`, /Authority=Developer ID Application:/.test(codeSignInfo));
    check(`${label} signature is not ad-hoc`, !/Signature=adhoc/i.test(codeSignInfo));
    check(`${label} hardened runtime is enabled`, /Runtime Version=/.test(codeSignInfo));

    const requestedTeamId = process.env.APPLE_TEAM_ID?.trim();
    const teamMatch = /TeamIdentifier=([A-Z0-9]+)/.exec(codeSignInfo);
    check(`${label} has a TeamIdentifier`, Boolean(teamMatch), codeSignInfo);
    if (requestedTeamId) {
      check(
        `${label} TeamIdentifier matches APPLE_TEAM_ID=${requestedTeamId}`,
        teamMatch?.[1] === requestedTeamId,
        teamMatch?.[1] ? `TeamIdentifier=${teamMatch[1]}` : 'missing TeamIdentifier',
      );
    }
  } catch (err) {
    check(`${label} signed codesign metadata is readable`, false, err.message);
  }

  try {
    commandOutput('spctl', ['--assess', '--type', 'execute', '--verbose=4', candidateAppPath]);
    check(`${label} Gatekeeper assessment accepts the app`, true);
  } catch (err) {
    check(`${label} Gatekeeper assessment accepts the app`, false, err.message);
  }

  try {
    commandOutput('xcrun', ['stapler', 'validate', candidateAppPath]);
    check(`${label} notarization ticket is stapled/valid`, true);
  } catch (err) {
    check(`${label} notarization ticket is stapled/valid`, false, err.message);
  }
}

async function verifyDefaultPayload(candidateAppAsar, label = '') {
  const labelPrefix = label ? `${label} ` : '';
  const files = listPackage(candidateAppAsar);
  const fileSet = new Set(files);

  for (const file of required) check(`${labelPrefix}asar includes ${file}`, fileSet.has(file));

  for (const item of forbidden) {
    const matches = files.filter((file) => {
      if (item.pattern) return file.startsWith(item.prefix) && item.pattern.test(file);
      return file === item.prefix || file.startsWith(`${item.prefix}/`);
    });
    check(
      `${labelPrefix}${item.label} absent from default release artifact`,
      matches.length === 0,
      `${matches.slice(0, 5).join(', ')}${matches.length > 5 ? ` (+${matches.length - 5} more)` : ''}`,
    );
  }

  const asarStats = await stat(candidateAppAsar);
  check(`${labelPrefix}app.asar is under 200 MB`, asarStats.size < 200_000_000, `${asarStats.size} bytes`);
}

function verifySignedDmgContainer(dmgPath) {
  try {
    commandOutput('spctl', ['--assess', '--type', 'open', '--verbose=4', dmgPath]);
    check('DMG Gatekeeper assessment accepts the disk image', true);
  } catch (err) {
    check('DMG Gatekeeper assessment accepts the disk image', false, err.message);
  }

  try {
    commandOutput('xcrun', ['stapler', 'validate', dmgPath]);
    check('DMG notarization ticket is stapled/valid', true);
  } catch (err) {
    check('DMG notarization ticket is stapled/valid', false, err.message);
  }
}

async function verifyMountedDmgApp(mountedAppPath) {
  check('DMG contains Roro.app', await exists(mountedAppPath), mountedAppPath);
  if (!(await exists(mountedAppPath))) return;

  const mounted = appBundlePaths(mountedAppPath);
  check('mounted DMG app binary exists', await exists(mounted.binaryPath), mounted.binaryPath);
  check('mounted DMG app app.asar exists', await exists(mounted.appAsar), mounted.appAsar);
  check('mounted DMG app Info.plist exists', await exists(mounted.infoPlist), mounted.infoPlist);

  if (await exists(mounted.infoPlist)) {
    try {
      const info = plistJson(mounted.infoPlist);
      check('mounted DMG app bundle identifier is com.jinchoi.roro', info.CFBundleIdentifier === 'com.jinchoi.roro');
      check('mounted DMG app bundle name is Roro', info.CFBundleName === 'Roro');
      check(
        `mounted DMG app version is ${packageVersion}`,
        info.CFBundleShortVersionString === packageVersion,
        `CFBundleShortVersionString=${info.CFBundleShortVersionString ?? '<missing>'}`,
      );
    } catch (err) {
      check('mounted DMG app Info.plist metadata is readable', false, err.stderr?.toString().trim() || err.message);
    }
  }

  if (await exists(mounted.appAsar)) {
    try {
      await verifyDefaultPayload(mounted.appAsar, 'mounted DMG app');
    } catch (err) {
      check('mounted DMG app asar is readable', false, err.message);
    }
  }

  verifyCodesign(mountedAppPath, 'mounted DMG app');
  if (mode === 'signed') verifySignedApp(mountedAppPath, 'mounted DMG app');
}

async function verifyDmgArtifact() {
  if (process.platform !== 'darwin') {
    check('DMG verification runs on macOS', false, `platform=${process.platform}`);
    return;
  }

  const { expectedPath, candidates, unexpected, dmgPath } = await findDmgArtifact();
  const foundDetail = candidates.length ? `found: ${candidates.join(', ')}` : 'found none';
  check('DMG artifact exists at expected path', Boolean(dmgPath), `${expectedPath}; ${foundDetail}`);
  check('DMG output contains only the expected artifact', unexpected.length === 0, unexpected.join(', '));
  if (!dmgPath) return;

  try {
    commandOutput('hdiutil', ['verify', dmgPath]);
    check('DMG verifies with hdiutil', true);
  } catch (err) {
    check('DMG verifies with hdiutil', false, err.message);
  }
  if (mode === 'signed') verifySignedDmgContainer(dmgPath);

  let mountDir = '';
  try {
    mountDir = await mkdtemp(join(tmpdir(), 'roro-dmg-'));
    commandOutput('hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountDir]);
    check('DMG mounts read-only', true);
    await verifyMountedDmgApp(join(mountDir, 'Roro.app'));
  } catch (err) {
    check('DMG mounts and contains Roro.app', false, err.message);
  } finally {
    if (mountDir) {
      try {
        commandOutput('hdiutil', ['detach', mountDir]);
      } catch {
        // Best-effort cleanup; the failure above is already reported if attach/mount failed.
      }
      await rm(mountDir, { recursive: true, force: true });
    }
  }
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

await verifyDefaultPayload(appAsar);

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

if (requireDmg || mode === 'signed') {
  await verifyDmgArtifact();
}

if (failures.length) {
  const summary =
    mode === 'signed'
      ? 'signed release artifact is not Developer-ID signed/notarized'
      : requireDmg
        ? 'default release artifact or DMG is not v0-clean'
      : 'default release artifact is not v0-clean';
  console.error(`\n[verify] FAILED - ${summary}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const passSummary =
  mode === 'signed'
    ? 'signed release artifact is Developer-ID signed/notarized and structurally complete'
    : requireDmg
      ? 'default release artifact and DMG are typed-only and structurally complete'
    : 'default release artifact is typed-only and structurally complete';
console.log(`\n[verify] PASS - ${passSummary}.`);
