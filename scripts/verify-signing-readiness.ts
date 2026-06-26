// scripts/verify-signing-readiness.ts - local Developer-ID signing readiness doctor.
//
// By default this does not notarize or authenticate with Apple. It verifies the local inputs that
// should be true before `npm run make`: complete Apple env shape, matching Developer ID Application
// cert, Apple CLI tools, and the entitlements file. With --check-notary-auth it also verifies
// Apple credential auth via `notarytool history`, without uploading a build artifact.

import { execFileSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APPLE_CRED_VARS,
  appleSigningEnvStatus,
  developerIdApplicationIdentities,
  hasDeveloperIdApplicationIdentity,
  notarytoolHistoryArgs,
  redactAppleSecrets,
} from '../src/build/macSigning';

const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok ${name}${detail ? ` - ${detail}` : ''}`);
  else {
    console.log(`  fail ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function warn(name: string, detail = ''): void {
  console.log(`  warn ${name}${detail ? ` - ${detail}` : ''}`);
}

function commandOutput(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function commandCheck(command: string, args: string[]): { ok: boolean; detail: string } {
  try {
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, detail: '' };
  } catch (err) {
    const e = err as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
    const detail = [
      e.stderr?.toString().trim(),
      e.stdout?.toString().trim(),
      e.message,
    ]
      .filter(Boolean)
      .join('\n');
    return { ok: false, detail };
  }
}

function fileExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

const allowUnsigned = process.argv.includes('--allow-unsigned');
const checkNotaryAuth = process.argv.includes('--check-notary-auth');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run release:doctor
  npm run verify:signing-readiness
  npm run verify:signing-auth

Checks local prerequisites for Developer-ID signing + notarization:
  - macOS host
  - APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID are all set
  - keychain contains a Developer ID Application cert matching APPLE_TEAM_ID
  - xcrun can find notarytool and stapler
  - build/entitlements.mac.plist exists

release:doctor allows the no-Apple-env unsigned/ad-hoc path and is safe for CI.
verify:signing-readiness is strict and fails unless the Developer-ID inputs are present.
verify:signing-auth also checks Apple credential authentication with notarytool history (no upload).

The actual signed/notarized artifact gate is still: npm run make, then npm run verify:release-artifact:signed.`);
  process.exit(0);
}

console.log('[signing] Developer-ID signing readiness');

check('host is macOS', process.platform === 'darwin', `platform=${process.platform}`);

const envStatus = appleSigningEnvStatus(process.env);
for (const name of APPLE_CRED_VARS) {
  const present = envStatus.present.includes(name);
  const detail = name === 'APPLE_TEAM_ID' && present ? `value=${process.env.APPLE_TEAM_ID?.trim()}` : '';
  if (present) check(`${name} is set`, true, detail);
  else if (allowUnsigned && envStatus.present.length === 0) warn(`${name} is unset`, 'unsigned/ad-hoc path selected');
  else check(`${name} is set`, false, 'missing');
}
if (envStatus.isPartial) {
  check(
    'Apple signing env is all-or-nothing',
    false,
    `missing ${envStatus.missing.join(', ')}; set all three or unset all three for unsigned dev builds`,
  );
}

const identityOutput = commandOutput('security', ['find-identity', '-v', '-p', 'codesigning']);
const identities = developerIdApplicationIdentities(identityOutput);
if (identities.length > 0) {
  check(
    'Developer ID Application identity exists',
    true,
    identities.map((identity) => `${identity.name} (${identity.teamId})`).join(', '),
  );
} else if (allowUnsigned && envStatus.present.length === 0) {
  warn('Developer ID Application identity not found', 'unsigned/ad-hoc path selected');
} else {
  check(
    'Developer ID Application identity exists',
    false,
    '`security find-identity -v -p codesigning` found none',
  );
}

const requestedTeamId = process.env.APPLE_TEAM_ID?.trim();
if (requestedTeamId) {
  check(
    `Developer ID identity matches APPLE_TEAM_ID=${requestedTeamId}`,
    hasDeveloperIdApplicationIdentity(identityOutput, requestedTeamId),
    identities.length ? `found team(s): ${identities.map((identity) => identity.teamId).join(', ')}` : '',
  );
} else if (identities.length > 0) {
  warn('APPLE_TEAM_ID is unset', `local Developer ID team appears to be ${identities[0].teamId}`);
}

const notarytool = commandOutput('xcrun', ['--find', 'notarytool']);
const stapler = commandOutput('xcrun', ['--find', 'stapler']);
check('notarytool is available', notarytool.length > 0, notarytool || 'xcrun --find notarytool failed');
check('stapler is available', stapler.length > 0, stapler || 'xcrun --find stapler failed');

const entitlementsPath = resolve(join('build', 'entitlements.mac.plist'));
check('hardened-runtime entitlements file exists', fileExists(entitlementsPath), entitlementsPath);

if (envStatus.isComplete && checkNotaryAuth) {
  const auth = commandCheck('xcrun', notarytoolHistoryArgs(process.env));
  check(
    'Apple credentials authenticate with notarytool',
    auth.ok,
    auth.ok ? 'notarytool history succeeded without uploading an artifact' : redactAppleSecrets(auth.detail, process.env),
  );
} else if (envStatus.isComplete) {
  warn('Apple credential authentication is not checked here', 'run npm run verify:signing-auth to check notarytool auth before make');
} else if (checkNotaryAuth && !allowUnsigned) {
  check('Apple credentials authenticate with notarytool', false, 'missing complete Apple env');
}

if (failures.length > 0) {
  console.log('\n[signing] FAILED - Developer-ID make/notarization is not ready.');
  if (envStatus.isComplete && checkNotaryAuth) {
    console.log('[signing] Human-owned next step: verify APPLE_ID, APPLE_TEAM_ID, and the app-specific APPLE_PASSWORD, then rerun:');
    console.log('  npm run verify:signing-auth');
    console.log('  npm run make');
  } else {
    console.log('[signing] Human-owned next step: set the missing Apple env vars, then rerun this doctor:');
    const suggestedTeamId = requestedTeamId || identities[0]?.teamId || '<team id>';
    console.log(`  export APPLE_TEAM_ID=${suggestedTeamId}`);
    console.log('  export APPLE_ID=<paid Apple ID email>');
    console.log('  export APPLE_PASSWORD=<app-specific password>');
    console.log(checkNotaryAuth ? '  npm run verify:signing-auth' : '  npm run verify:signing-readiness');
    console.log('  npm run make');
  }
  process.exit(1);
}

if (allowUnsigned && envStatus.present.length === 0) {
  console.log('\n[signing] PASS - unsigned/ad-hoc release path is coherent; strict Developer-ID inputs are not set.');
  console.log('[signing] Next signed-release gate: export Apple env vars, run npm run verify:signing-readiness, npm run verify:signing-auth, then npm run make.');
} else {
  console.log('\n[signing] PASS - local Developer-ID signing inputs are present.');
  if (checkNotaryAuth) {
    console.log('[signing] Next gate: npm run make, then npm run verify:release-artifact:signed.');
  } else {
    console.log('[signing] Next gate: npm run verify:signing-auth, then npm run make.');
  }
}
