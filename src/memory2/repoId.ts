// src/memory2/repoId.ts — a stable, deterministic project scope for a memory.
//
// The same repo path always yields the same id across turns/sessions, so recall can boost (and later
// filter) by the project a memory belongs to — the foundation of repo-scoped "remembers you HERE". Derived
// from the NORMALIZED absolute path (trailing separators stripped); a short sha256 prefix keeps it opaque +
// fixed-length so it's a clean index key. (A git-remote-derived id — resilient to clones/moves — is a
// deliberate later refinement; the path is stable enough for v1, where the user's repo lives at one path.)

import { createHash } from 'node:crypto';

export function repoId(repoPath: string): string {
  const normalized = repoPath.trim().replace(/[/\\]+$/, ''); // strip trailing path separators
  if (!normalized) return ''; // no repo (e.g. RORO_WORKDIR unset) → no project scope
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
