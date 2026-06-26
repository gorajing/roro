// src/main/processOutput.ts — keep broken stdout/stderr pipes from crashing the Electron main process.

type ErrorStream = {
  on(event: 'error', listener: (err: unknown) => void): unknown;
};

type ErrorProcess = {
  emit(event: string | symbol, ...args: unknown[]): boolean;
};

type BrokenPipeGuardOptions = {
  streams?: ErrorStream[];
  processTarget?: ErrorProcess;
};

const guardedStreams = new WeakSet<object>();
const guardedProcesses = new WeakSet<object>();

export function isBrokenPipeError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'EPIPE',
  );
}

export function installBrokenPipeGuard(options: BrokenPipeGuardOptions = {}): void {
  const {
    streams = [process.stdout, process.stderr],
    processTarget = process,
  } = options;

  for (const stream of streams) {
    if (guardedStreams.has(stream)) continue;
    stream.on('error', (err) => {
      if (isBrokenPipeError(err)) return;
      throw err;
    });
    guardedStreams.add(stream);
  }

  if (!guardedProcesses.has(processTarget)) {
    const emit = processTarget.emit.bind(processTarget);
    processTarget.emit = (event: string | symbol, ...args: unknown[]): boolean => {
      if (event === 'uncaughtException' && isBrokenPipeError(args[0])) return true;
      return emit(event, ...args);
    };
    guardedProcesses.add(processTarget);
  }
}
