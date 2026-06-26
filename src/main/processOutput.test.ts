import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installBrokenPipeGuard, isBrokenPipeError } from './processOutput';

class FakeErrorStream extends EventEmitter {
  override on(event: 'error', listener: (err: unknown) => void): this {
    return super.on(event, listener);
  }
}

class FakeProcess extends EventEmitter {
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
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
    installBrokenPipeGuard({ streams: [stream], processTarget: new FakeProcess() });

    expect(() => {
      stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    }).not.toThrow();
  });

  it('still fails loud for non-EPIPE stream errors', () => {
    const stream = new FakeErrorStream();
    installBrokenPipeGuard({ streams: [stream], processTarget: new FakeProcess() });

    expect(() => {
      stream.emit('error', Object.assign(new Error('bad fd'), { code: 'EBADF' }));
    }).toThrow('bad fd');
  });

  it('short-circuits uncaught EPIPE exceptions before Electron can show its main-process modal', () => {
    const fakeProcess = new FakeProcess();
    const electronHandler = vi.fn(() => {
      throw new Error('Electron modal would show');
    });
    fakeProcess.on('uncaughtException', electronHandler);
    installBrokenPipeGuard({ streams: [], processTarget: fakeProcess });

    expect(() => {
      fakeProcess.emit('uncaughtException', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    }).not.toThrow();
    expect(electronHandler).not.toHaveBeenCalled();
  });

  it('still lets non-EPIPE uncaught exceptions reach the existing handlers', () => {
    const fakeProcess = new FakeProcess();
    const existingHandler = vi.fn(() => {
      throw new Error('boom');
    });
    fakeProcess.on('uncaughtException', existingHandler);
    installBrokenPipeGuard({ streams: [], processTarget: fakeProcess });

    expect(() => {
      fakeProcess.emit('uncaughtException', Object.assign(new Error('boom'), { code: 'EINVAL' }));
    }).toThrow('boom');
    expect(existingHandler).toHaveBeenCalledTimes(1);
  });

  it('is idempotent per stream and process emitter', () => {
    const stream = new FakeErrorStream();
    const fakeProcess = new FakeProcess();
    const existingHandler = vi.fn();
    fakeProcess.on('uncaughtException', existingHandler);
    installBrokenPipeGuard({ streams: [stream], processTarget: fakeProcess });
    installBrokenPipeGuard({ streams: [stream], processTarget: fakeProcess });

    expect(stream.listenerCount('error')).toBe(1);
    expect(fakeProcess.listenerCount('uncaughtException')).toBe(1);
    fakeProcess.emit('uncaughtException', Object.assign(new Error('non-EPIPE'), { code: 'EINVAL' }));
    expect(existingHandler).toHaveBeenCalledTimes(1);
  });
});
