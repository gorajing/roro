import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { migrateLegacyEnv, LEGACY_ENV_MAP } from './env';

const ALL_KEYS = [...Object.keys(LEGACY_ENV_MAP), ...Object.values(LEGACY_ENV_MAP)];

describe('migrateLegacyEnv (COMPANION_ -> RORO_ back-compat)', () => {
  beforeEach(() => { for (const k of ALL_KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of ALL_KEYS) delete process.env[k]; });

  it('copies a set legacy COMPANION_ var onto its RORO_ successor', () => {
    process.env.COMPANION_WORKDIR = '/tmp/x';
    migrateLegacyEnv();
    expect(process.env.RORO_WORKDIR).toBe('/tmp/x');
  });

  it('RORO_ wins when both are set (never clobbers the new name)', () => {
    process.env.RORO_DB_DIR = '/new';
    process.env.COMPANION_DB_DIR = '/old';
    migrateLegacyEnv();
    expect(process.env.RORO_DB_DIR).toBe('/new');
  });

  it('is a no-op when neither is set', () => {
    migrateLegacyEnv();
    expect(process.env.RORO_FLOATING_WINDOW).toBeUndefined();
  });

  it('warns exactly once per deprecated var', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.COMPANION_CODEX_BIN = '/bin/codex';
    migrateLegacyEnv();
    migrateLegacyEnv(); // idempotent — must not re-warn
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('COMPANION_CODEX_BIN'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });
});
