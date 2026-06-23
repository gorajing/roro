// src/shared/env.ts — back-compat shim for the COMPANION_* -> RORO_* env-var rename.
//
// The internal env prefix was renamed Companion -> Roro. To avoid silently breaking existing .env
// files / run scripts, migrateLegacyEnv() copies any set COMPANION_* var onto its RORO_* successor
// (when the new name is unset) and warns ONCE. It must run BEFORE any module reads these vars — some
// read at MODULE LOAD (src/main/window.ts, src/executor/*) — so it's invoked via a side-effect import
// placed first in the main entry (src/shared/env-migrate.ts). RORO_* always wins if both are set.

declare const process: { env: Record<string, string | undefined> };

/** current RORO_ name -> deprecated COMPANION_ name, for every renamed process env var. */
export const LEGACY_ENV_MAP: Record<string, string> = {
  RORO_DEBUG_PORT: 'COMPANION_DEBUG_PORT',
  RORO_DB_DIR: 'COMPANION_DB_DIR',
  RORO_WORKDIR: 'COMPANION_WORKDIR',
  RORO_CODEX_BIN: 'COMPANION_CODEX_BIN',
  RORO_CLAUDE_BIN: 'COMPANION_CLAUDE_BIN',
  RORO_FLOATING_WINDOW: 'COMPANION_FLOATING_WINDOW',
};

const warned = new Set<string>();

/** Idempotent. Copies set COMPANION_* vars onto their RORO_* successors (RORO_* wins), warning once each. */
export function migrateLegacyEnv(): void {
  for (const [next, legacy] of Object.entries(LEGACY_ENV_MAP)) {
    const legacyVal = process.env[legacy];
    if (legacyVal !== undefined && process.env[next] === undefined) {
      process.env[next] = legacyVal;
      if (!warned.has(legacy)) {
        warned.add(legacy);
        console.warn(`[env] ${legacy} is deprecated — use ${next}. Honoring ${legacy} for now.`);
      }
    }
  }
}
