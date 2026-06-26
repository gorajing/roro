// src/main/processOutput.ts — keep broken stdout/stderr pipes from crashing the Electron main process.

type ErrorStream = {
  on(event: 'error', listener: (err: unknown) => void): unknown;
};

const guardedStreams = new WeakSet<object>();

export function isBrokenPipeError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'EPIPE',
  );
}

export function installBrokenPipeGuard(
  streams: ErrorStream[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    if (guardedStreams.has(stream)) continue;
    stream.on('error', (err) => {
      if (isBrokenPipeError(err)) return;
      throw err;
    });
    guardedStreams.add(stream);
  }
}
