import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installBrokenPipeGuard, isBrokenPipeError } from './processOutput';

class FakeErrorStream extends EventEmitter {
  override on(event: 'error', listener: (err: unknown) => void): this {
    return super.on(event, listener);
  }
}

describe('processOutput — broken pipe guard', () => {
  it('recognizes only EPIPE as a broken pipe', () => {
    expect(isBrokenPipeError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error('bad fd'), { code: 'EBADF' }))).toBe(false);
    expect(isBrokenPipeError(new Error('write EPIPE'))).toBe(false);
  });

  it('swallows stdout/stderr EPIPE errors', () => {
    const stream = new FakeErrorStream();
    installBrokenPipeGuard([stream]);

    expect(() => {
      stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    }).not.toThrow();
  });

  it('still fails loud for non-EPIPE stream errors', () => {
    const stream = new FakeErrorStream();
    installBrokenPipeGuard([stream]);

    expect(() => {
      stream.emit('error', Object.assign(new Error('bad fd'), { code: 'EBADF' }));
    }).toThrow('bad fd');
  });

  it('is idempotent per stream', () => {
    const stream = new FakeErrorStream();
    installBrokenPipeGuard([stream]);
    installBrokenPipeGuard([stream]);

    expect(stream.listenerCount('error')).toBe(1);
  });
});
