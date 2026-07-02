// src/core/ports/boundary.test.ts — the import boundary that keeps the core Electron-free.
//
// Scans every core .ts file (production AND test) for an `electron` module reference in ANY form —
// static `from 'electron'`, side-effect `import 'electron'`, DYNAMIC `import('electron')` (the form
// memory2 once used), and `require('electron')` — and fails naming the offender. This is the "real"
// boundary the design panel settled on: eslint's no-restricted-imports rule catches the static forms,
// but only a content scan catches the dynamic import, so both run by construction.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

// The whole Electron-free core lives under src/core (W7's atomic move landed it there).
const CORE_ROOT = 'src/core';

// This file quotes the literal 'electron' (regex + messages) — never scan it.
const SELF = 'boundary.test.ts';

function collect(root: string, out: string[]): void {
  for (const entry of readdirSync(join(REPO_ROOT, root), { withFileTypes: true })) {
    const rel = join(root, entry.name);
    if (entry.isDirectory()) {
      collect(rel, out);
    } else if (entry.name.endsWith('.ts') && entry.name !== SELF) {
      out.push(rel);
    }
  }
}

function coreFiles(): string[] {
  const out: string[] = [];
  collect(CORE_ROOT, out);
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
