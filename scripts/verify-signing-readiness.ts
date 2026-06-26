// scripts/verify-signing-readiness.ts - local Developer-ID signing readiness doctor.
//
// This does not notarize or authenticate with Apple. It verifies the local inputs that should be true
// before `npm run make`: complete Apple env shape, matching Developer ID Application cert, Apple CLI
// tools, and the entitlements file. The actual notarization/authentication gate remains `npm run make`.

import { execFileSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APPLE_CRED_VARS,
  appleSigningEnvStatus,
  developerIdApplicationIdentities,
  hasDeveloperIdApplicationIdentity,
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

function fileExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

const allowUnsigned = process.argv.includes('--allow-unsigned');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run release:doctor
  npm run verify:signing-readiness

Checks local prerequisites for Developer-ID signing + notarization:
  - macOS host
  - APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID are all set
  - keychain contains a Developer ID Application cert matching APPLE_TEAM_ID
  - xcrun can find notarytool and stapler
  - build/entitlements.mac.plist exists

release:doctor allows the no-Apple-env unsigned/ad-hoc path and is safe for CI.
verify:signing-readiness is strict and fails unless the Developer-ID inputs are present.

This does not verify the Apple ID password with Apple's notary service.
The actual signed/notarized artifact gate is: npm run make`);
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

if (envStatus.isComplete) {
  warn('Apple credential authentication is not checked here', '`npm run make` submits to notarytool and is the real auth gate');
}

if (failures.length > 0) {
  console.error('\n[signing] FAILED - Developer-ID make/notarization is not ready.');
  console.error('[signing] Human-owned next step: set the missing Apple env vars, then rerun this doctor:');
  const suggestedTeamId = requestedTeamId || identities[0]?.teamId || '<team id>';
  console.error(`  export APPLE_TEAM_ID=${suggestedTeamId}`);
  console.error('  export APPLE_ID=<paid Apple ID email>');
  console.error('  export APPLE_PASSWORD=<app-specific password>');
  console.error('  npm run verify:signing-readiness');
  console.error('  npm run make');
  process.exit(1);
}

if (allowUnsigned && envStatus.present.length === 0) {
  console.log('\n[signing] PASS - unsigned/ad-hoc release path is coherent; strict Developer-ID inputs are not set.');
  console.log('[signing] Next signed-release gate: export Apple env vars, run npm run verify:signing-readiness, then npm run make.');
} else {
  console.log('\n[signing] PASS - local Developer-ID signing inputs are present.');
  console.log('[signing] Next gate: npm run make, then verify the signed/notarized build on a clean second Mac.');
}
