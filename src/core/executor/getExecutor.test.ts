import { describe, expect, it } from 'vitest';
import { getExecutor, ClaudeExecutor, ClaudeSdkExecutor, CodexExecutor } from './index';
import { guardDeferredEnv } from '../../shared/releaseChannel';

// The flag-gated backend selection (W6 C5). The Agent-SDK executor is DARK: it is selected ONLY for
// agent 'claude' AND only when RORO_SDK_EXECUTOR === '1', read through guardDeferredEnv so a
// release/cohort build (which strips every deferred-v0 key) can never select it from a launch-time
// env. These pins mirror the locate-gate lesson: routing must be tested in BOTH directions and at
// the release boundary, not just the happy path.

describe('getExecutor — flag-gated SDK selection', () => {
  it('flag OFF (unset): claude → the CLI adapter (the default), never the SDK', () => {
    expect(getExecutor('claude', {})).toBe(ClaudeExecutor);
  });

  it("flag present but not '1' does NOT select the SDK (exact-match membership, like RORO_EXECUTOR_FACTS)", () => {
    expect(getExecutor('claude', { RORO_SDK_EXECUTOR: '0' })).toBe(ClaudeExecutor);
    expect(getExecutor('claude', { RORO_SDK_EXECUTOR: 'true' })).toBe(ClaudeExecutor);
    expect(getExecutor('claude', { RORO_SDK_EXECUTOR: '' })).toBe(ClaudeExecutor);
  });

  it("flag ON ('1'): claude → the Agent-SDK executor", () => {
    expect(getExecutor('claude', { RORO_SDK_EXECUTOR: '1' })).toBe(ClaudeSdkExecutor);
  });

  it('the flag NEVER re-routes a non-claude agent — codex stays the codex CLI even with the flag on', () => {
    expect(getExecutor('codex', { RORO_SDK_EXECUTOR: '1' })).toBe(CodexExecutor);
  });

  it('RELEASE DARKNESS: on the release channel guardDeferredEnv strips the flag → CLI adapter even with it set', () => {
    // getExecutor reads through guardDeferredEnv; composing the release strip here proves that a
    // shipped build cannot select the SDK executor from a launch-time env.
    const releaseEnv = guardDeferredEnv({ RORO_SDK_EXECUTOR: '1' }, 'release');
    expect(releaseEnv.RORO_SDK_EXECUTOR).toBeUndefined();
    expect(getExecutor('claude', releaseEnv)).toBe(ClaudeExecutor);
  });
});
