// src/core/ports/boundary.test.ts — the import boundary that keeps the core Electron-free.
//
// Scans every core .ts file (production AND test) for an `electron` module reference in ANY form —
// static `from 'electron'`, side-effect `import 'electron'`, DYNAMIC `import('electron')` (the form
// memory2 once used), and `require('electron')` — and fails naming the offender. This is the "real"
// boundary the design panel settled on: eslint's no-restricted-imports rule catches the static forms,
// but only a content scan catches the dynamic import, so both run by construction.
//
// C3 scopes this to the FUTURE core dirs IN PLACE. src/main is a MIX (the core carve-out that moves to
// src/core/orchestrator in C4 + the shell residue that STAYS); the shell residue is excluded by
// basename. The atomic move C4 collapses CORE_ROOTS to ['src/core'] and drops the src/main handling.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

// Wholly-core dirs — each moves under src/core in C4.
const CORE_DIRS = ['src/core', 'src/executor', 'src/brain', 'src/memory2', 'src/vision', 'src/ambient'];

// The shell residue that STAYS in src/main (everything else under src/main is the core carve-out).
// Excluded by basename so the carve-out is scanned while the true shell — which legitimately imports
// electron — is not.
const SHELL_RESIDUE = new Set([
  'ipc.ts', 'ipc.config.test.ts', 'ipc.factProposals.test.ts', 'ipc.memory.test.ts',
  'window.ts', 'windowRegistry.ts', 'windowRegistry.test.ts',
  'safeSend.ts', 'safeSend.test.ts', 'pointerOverlay.ts', 'pointerOverlay.test.ts',
  'navigation.ts', 'navigation.test.ts', 'openExternalGuard.ts', 'openExternalGuard.test.ts',
  'summon.ts', 'summon.test.ts',
  'processOutput.ts', 'processOutput.test.ts', 'processOutputGuard.ts',
  'platformPorts.ts',
]);

// This file quotes the literal 'electron' (regex + messages) — never scan it.
const SELF = 'boundary.test.ts';

function collect(root: string, shellExclude: boolean, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(REPO_ROOT, root), { withFileTypes: true });
  } catch {
    return; // a root that doesn't exist yet — defensive across the move
  }
  for (const entry of entries) {
    const rel = join(root, entry.name);
    if (entry.isDirectory()) {
      collect(rel, shellExclude, out);
    } else if (entry.name.endsWith('.ts') && entry.name !== SELF) {
      if (shellExclude && SHELL_RESIDUE.has(entry.name)) continue;
      out.push(rel);
    }
  }
}

function coreFiles(): string[] {
  const out: string[] = [];
  for (const dir of CORE_DIRS) collect(dir, false, out);
  collect('src/main', true, out);
  return out;
}

// An `electron` (or `electron/...`) module specifier in a static / side-effect / dynamic import or
// require — NOT a bare mention in prose (which has no from/import(/require( in front of the quote).
const ELECTRON_SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]electron(?:\/[^'"]*)?['"]/;

describe('core import boundary — the core is Electron-free', () => {
  it('scans a non-trivial set of core files (guards against a broken/empty walk)', () => {
    expect(coreFiles().length).toBeGreaterThan(50);
  });

  it('no core file references the electron module (static, side-effect, dynamic, or require)', () => {
    const offenders = coreFiles().filter((file) =>
      ELECTRON_SPECIFIER.test(readFileSync(join(REPO_ROOT, file), 'utf8')),
    );
    expect(offenders, `core files must not reference electron:\n${offenders.join('\n')}`).toEqual([]);
  });
});
