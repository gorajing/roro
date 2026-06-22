import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatCompletions } from './index';

// A fake ProxyResponse that records the lifecycle calls we care about.
function fakeRes() {
  const calls = { writes: 0, ended: false, destroyed: null as Error | null, json: undefined as unknown };
  const res = {
    statusCode: 0,
    headersSent: false,
    status(c: number) { this.statusCode = c; return this; },
    type() { return this; },
    json(b: unknown): unknown { calls.json = b; return undefined; },
    send(): unknown { return undefined; },
    setHeader() { /* noop */ },
    flushHeaders() { this.headersSent = true; },
    write() { this.headersSent = true; calls.writes++; return true; },
    end() { calls.ended = true; },
    destroy(e?: Error) { calls.destroyed = e ?? new Error('destroyed'); },
  };
  return { res, calls };
}

// An upstream whose stream yields one chunk, then errors mid-stream (a reset / dropped connection).
function throwingUpstream() {
  async function* body() {
    yield new Uint8Array([1, 2, 3]);
    throw new Error('upstream reset');
  }
  return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: body() };
}

describe('proxy streamChatCompletions — mid-stream upstream failure', () => {
  beforeEach(() => {
    process.env.NEBIUS_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('aborts the response (does NOT cleanly end) and logs when the upstream stream errors after headers are sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => throwingUpstream()));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, calls } = fakeRes();

    await streamChatCompletions({ body: {} } as never, res as never);

    expect(res.headersSent).toBe(true); // we already started streaming
    expect(calls.writes).toBeGreaterThan(0); // the first chunk went out
    // A clean res.end() here would look to the client like a COMPLETE stream (silent truncation).
    // The fix must destroy the connection so the client sees an aborted stream, and log it.
    expect(calls.destroyed).toBeInstanceOf(Error);
    expect(calls.ended).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});
