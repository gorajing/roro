import { describe, it, expect } from 'vitest';
import { buildFactPrompt, parseFactResponse, isPlausiblePreference } from './extractFact';

describe('isPlausiblePreference — gate extraction toward null (the 3B model cannot)', () => {
  const inp = (transcript: string) => ({ transcript, narration: 'ok', outcome: 'answered' as const });

  it('passes turns that read like a stated preference / convention', () => {
    for (const t of ['from now on always use pnpm', 'I prefer tabs over spaces', 'our tests always live in tests', 'by default use 2-space indent', 'we use vitest in this repo']) {
      expect(isPlausiblePreference(inp(t)), t).toBe(true);
    }
  });

  it('BLOCKS one-off tasks / chitchat / questions (no preference language → no model call)', () => {
    for (const t of ['add a logout route', 'fix the typo on line 5', 'thanks', 'run the tests', 'what time is it', 'deploy to staging', 'create a new branch']) {
      expect(isPlausiblePreference(inp(t)), t).toBe(false);
    }
  });

  it('is CONSERVATIVE: a marker-less preference is missed (favours silence over a wrong fact)', () => {
    // documents the known recall gap — "a missed fact is harmless; a wrong fact poisons the profile"
    expect(isPlausiblePreference(inp('use vitest, not jest'))).toBe(false);
  });
});

describe('parseFactResponse (null-when-unsure)', () => {
  it('returns a candidate for a well-formed fact', () => {
    const out = parseFactResponse('{"key":"tests_with_features","value":"writes a test alongside each feature"}');
    expect(out).toEqual({ key: 'tests_with_features', value: 'writes a test alongside each feature' });
  });
  it('tolerates code fences', () => {
    const out = parseFactResponse('```json\n{"key":"pkg_manager","value":"uses pnpm"}\n```');
    expect(out).toEqual({ key: 'pkg_manager', value: 'uses pnpm' });
  });
  it('returns null for the literal null sentinel', () => {
    expect(parseFactResponse('null')).toBeNull();
    expect(parseFactResponse('{"key":null,"value":null}')).toBeNull();
  });
  it('returns null for garbage / empty / missing fields (never throws)', () => {
    expect(parseFactResponse('')).toBeNull();
    expect(parseFactResponse('not json')).toBeNull();
    expect(parseFactResponse('{"key":"x"}')).toBeNull();
    expect(parseFactResponse('{"value":"y"}')).toBeNull();
    expect(parseFactResponse('{"key":"","value":"  "}')).toBeNull();
    expect(parseFactResponse('{"key":"!!!","value":"x"}')).toBeNull(); // key normalizes to empty
  });

  it('normalizes the key to canonical snake_case so case/punctuation variants supersede', () => {
    expect(parseFactResponse('{"key":"Pkg_Manager","value":"uses pnpm"}')).toEqual({ key: 'pkg_manager', value: 'uses pnpm' });
    expect(parseFactResponse('{"key":"pkg-manager","value":"uses pnpm"}')).toEqual({ key: 'pkg_manager', value: 'uses pnpm' });
    expect(parseFactResponse('{"key":" Package Manager ","value":"uses pnpm"}')).toEqual({ key: 'package_manager', value: 'uses pnpm' });
  });

  // Recall renders the VALUE verbatim ("- ${value}"), so a bare boolean value surfaces as the noise line
  // "- true". The 3B model collapses behavioral habits ("I always write a test...") to value:"true" — reject
  // those (→ null, the safe direction) so garbage never reaches the profile. (Observed live; see crosslaunch.live.)
  it('rejects a bare boolean / yes-no / placeholder value (would render as a useless "- true" memory line)', () => {
    for (const v of ['true', 'false', 'yes', 'no', 'y', 'n', 'Yes', ' TRUE ', 'N/A', 'na', 'none', 'null', 'nil', 'undefined', '0', '1']) {
      expect(parseFactResponse(`{"key":"test_driven_development","value":${JSON.stringify(v)}}`), v).toBeNull();
    }
  });
  it('keeps legitimate values that merely CONTAIN a boolean token (whole-string match, never substring)', () => {
    for (const v of ['no semicolons', 'node 20', '1 space', 'yes-always squash', '100-char line limit']) {
      expect(parseFactResponse(`{"key":"k","value":${JSON.stringify(v)}}`), v).not.toBeNull();
    }
  });
});

describe('buildFactPrompt', () => {
  it('includes the transcript and demands a single fact or null', () => {
    const p = buildFactPrompt({ transcript: 'use pnpm not npm', narration: 'ok', outcome: 'answered' });
    expect(p).toContain('use pnpm not npm');
    expect(p.toLowerCase()).toContain('null');
  });
});
