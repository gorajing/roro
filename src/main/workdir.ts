// src/main/workdir.ts — choose the repo the coding agent runs in, FAIL-LOUD when none is chosen.
//
// The executor edits files on disk, so "which directory?" is a safety decision, not a convenience default.
// The old behaviour silently fell back to process.cwd(); in a packaged app cwd is the app bundle or the
// user's home, and running from source it is roro's OWN checkout — so a silent default could mutate the
// wrong tree. We REFUSE instead, and require an explicit choice (RORO_WORKDIR) or an explicit dev opt-in.

export interface WorkdirEnv {
  RORO_WORKDIR?: string;
  RORO_ALLOW_CWD?: string;
}

/**
 * Resolve the repo Roro's coding agent edits. RORO_WORKDIR is the chosen project. With none set we throw
 * rather than silently use `cwd`; RORO_ALLOW_CWD=1 is the explicit local-dev opt-in to use the current dir.
 */
export function resolveWorkdir(env: WorkdirEnv, cwd: string): string {
  const chosen = env.RORO_WORKDIR?.trim();
  if (chosen) return chosen;
  if (env.RORO_ALLOW_CWD === '1') return cwd;
  throw new Error(
    'Roro has no working repo set: choose a project with RORO_WORKDIR (or set RORO_ALLOW_CWD=1 to use the ' +
      'current directory in local dev). Refusing to run the coding agent against an unchosen directory.',
  );
}
