import { describe, it, expect } from 'vitest';
import { buildFactPrompt, parseFactResponse } from './extractFact';

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
});

describe('buildFactPrompt', () => {
  it('includes the transcript and demands a single fact or null', () => {
    const p = buildFactPrompt({ transcript: 'use pnpm not npm', narration: 'ok', outcome: 'answered' });
    expect(p).toContain('use pnpm not npm');
    expect(p.toLowerCase()).toContain('null');
  });
});
