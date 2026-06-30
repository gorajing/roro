import { describe, it, expect, vi } from 'vitest';
import { classifyObservation, observeOnce } from './eye';

describe('classifyObservation — kind', () => {
  it('flags a destructive command as risk', () => {
    expect(classifyObservation('terminal: user typed rm -rf ~/ at the prompt').kind).toBe('risk');
    expect(classifyObservation('about to git push --force to main').kind).toBe('risk');
  });

  it('flags a force-push in the refspec form (flag after the push arguments)', () => {
    expect(classifyObservation('terminal: git push origin main --force').kind).toBe('risk');
    expect(classifyObservation('git push origin main -f').kind).toBe('risk');
    expect(classifyObservation('git push origin main --force-with-lease').kind).toBe('risk');
  });

  it('risk outranks other activity in the same caption', () => {
    expect(classifyObservation('a test passed and the user typed rm -rf /').kind).toBe('risk');
  });

  it('reads a failure/result/change as change', () => {
    expect(classifyObservation('tests/test_login FAILED in the terminal').kind).toBe('change');
    expect(classifyObservation('the build passed').kind).toBe('change');
    expect(classifyObservation('an error appeared in the editor').kind).toBe('change');
  });

  it('a change outranks an otherwise-idle description', () => {
    expect(classifyObservation('mostly idle, but a test just failed').kind).toBe('change');
  });

  it('reads a quiet screen as idle', () => {
    expect(classifyObservation('the terminal is idle with no new output').kind).toBe('idle');
    expect(classifyObservation('nothing notable, the screen is unchanged').kind).toBe('idle');
  });

  it('reads an uninterpretable caption as unknown', () => {
    expect(classifyObservation('a calm desktop with a wallpaper').kind).toBe('unknown');
  });
});

describe('classifyObservation — app + what', () => {
  it('detects the surface in focus', () => {
    expect(classifyObservation('terminal shows a failed test').app).toBe('terminal');
    expect(classifyObservation('the editor has an error').app).toBe('editor');
    expect(classifyObservation('a browser tab updated').app).toBe('browser');
    expect(classifyObservation('something changed somewhere').app).toBeUndefined();
  });

  it('carries the (trimmed, bounded) caption as `what`', () => {
    const obs = classifyObservation('  test_login FAILED  ');
    expect(obs.what).toBe('test_login FAILED');
    expect(classifyObservation('x'.repeat(500)).what?.length).toBe(200);
  });
});

describe('observeOnce', () => {
  it('captures, describes, and classifies — with injected deps (no real screen/model)', async () => {
    const capture = vi.fn().mockResolvedValue({ b64: 'AAAA', mime: 'image/jpeg' });
    const describe = vi.fn().mockResolvedValue('terminal: test_login FAILED');
    const obs = await observeOnce({ capture, describe });
    expect(capture).toHaveBeenCalledOnce();
    expect(describe).toHaveBeenCalledWith({ b64: 'AAAA', mime: 'image/jpeg' });
    expect(obs).toEqual({ kind: 'change', app: 'terminal', what: 'terminal: test_login FAILED' });
  });
});
