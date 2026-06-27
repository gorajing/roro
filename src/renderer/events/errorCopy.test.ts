import { describe, expect, it } from 'vitest';
import { actionableErrorCopy, isStoppedTerminalError, typedTurnEndStatus } from './errorCopy';

describe('actionableErrorCopy', () => {
  it('turns a missing Codex CLI spawn error into an install/override action', () => {
    expect(actionableErrorCopy('spawn codex ENOENT')).toBe(
      'Codex CLI not found. Install Codex or set RORO_CODEX_BIN to the CLI path, then try again.',
    );
  });

  it('turns a missing Claude CLI spawn error into an install/override action', () => {
    expect(actionableErrorCopy('spawn claude ENOENT')).toBe(
      'Claude CLI not found. Install Claude or set RORO_CLAUDE_BIN to the CLI path, then try again.',
    );
  });

  it('turns Claude auth failures into executor-auth guidance', () => {
    expect(actionableErrorCopy('claude error: 401 unauthorized api key')).toBe(
      'Claude executor is not authenticated. Sign in to the Claude CLI or set ANTHROPIC_API_KEY for that executor, then try again. Roro does not manage executor accounts.',
    );
  });

  it('turns Codex auth failures into executor-auth guidance', () => {
    expect(actionableErrorCopy('openai codex error: forbidden 403 login required')).toBe(
      'Codex executor is not authenticated. Sign in to the Codex CLI or configure its API key for that executor, then try again. Roro does not manage executor accounts.',
    );
  });

  it('keeps unknown errors but bounds their length', () => {
    const copy = actionableErrorCopy(`disk full ${'x'.repeat(400)}`);
    expect(copy).toMatch(/^disk full x+/);
    expect(copy.length).toBeLessThanOrEqual(240);
  });
});

describe('typedTurnEndStatus', () => {
  it('does not call a failed turn done when runEnd arrives', () => {
    expect(typedTurnEndStatus(false, 'spawn codex ENOENT')).toBe(
      'Task hit a problem: Codex CLI not found. Install Codex or set RORO_CODEX_BIN to the CLI path, then try again.',
    );
  });

  it('keeps the stopped copy for user cancellation', () => {
    expect(typedTurnEndStatus(true, 'spawn codex ENOENT')).toBe('Stopped.');
  });

  it('keeps the success copy when no terminal error was seen', () => {
    expect(typedTurnEndStatus(false, null)).toBe('Done — type another task.');
  });
});

describe('isStoppedTerminalError', () => {
  it('recognizes stopped/cancelled executor terminal failures as user cancellation', () => {
    expect(isStoppedTerminalError('stopped')).toBe(true);
    expect(isStoppedTerminalError('aborted')).toBe(true);
    expect(isStoppedTerminalError('cancelled by user')).toBe(true);
    expect(isStoppedTerminalError('canceled by user')).toBe(true);
  });

  it('does not classify ordinary failures as stopped turns', () => {
    expect(isStoppedTerminalError('spawn codex ENOENT')).toBe(false);
    expect(isStoppedTerminalError('')).toBe(false);
  });
});
