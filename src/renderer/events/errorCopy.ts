import { isStoppedTerminalError } from '../../shared/stopped';

const MAX_GENERIC_ERROR_CHARS = 240;

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string): string {
  const clean = compact(text);
  return clean.length > MAX_GENERIC_ERROR_CHARS
    ? `${clean.slice(0, MAX_GENERIC_ERROR_CHARS - 3)}...`
    : clean;
}

function missingCliName(error: string): 'Codex' | 'Claude' | null {
  const match = /\bspawn\s+([^\s/]+)(?:\s|\b).*?\bENOENT\b/i.exec(error);
  const bin = match?.[1]?.toLowerCase();
  if (bin?.includes('claude')) return 'Claude';
  if (bin?.includes('codex')) return 'Codex';
  if (/\bclaude\b.*\bENOENT\b/i.test(error)) return 'Claude';
  if (/\bcodex\b.*\bENOENT\b/i.test(error)) return 'Codex';
  return null;
}

export function actionableErrorCopy(error: string): string {
  const clean = compact(error);
  if (!clean) return 'The coding agent failed without an error message.';

  const missingCli = missingCliName(clean);
  if (missingCli) {
    const envVar = missingCli === 'Claude' ? 'RORO_CLAUDE_BIN' : 'RORO_CODEX_BIN';
    return `${missingCli} CLI not found. Install ${missingCli} or set ${envVar} to the CLI path, then try again.`;
  }

  if (/\bclaude\b|\banthropic\b/i.test(clean) && /\b(auth|login|api key|unauthorized|unauthorised|forbidden|401|403)\b/i.test(clean)) {
    return 'Claude executor is not authenticated. Sign in to the Claude CLI or set ANTHROPIC_API_KEY for that executor, then try again. Roro does not manage executor accounts.';
  }

  if (/\bcodex\b|\bopenai\b/i.test(clean) && /\b(auth|login|api key|unauthorized|unauthorised|forbidden|401|403)\b/i.test(clean)) {
    return 'Codex executor is not authenticated. Sign in to the Codex CLI or configure its API key for that executor, then try again. Roro does not manage executor accounts.';
  }

  return clip(clean);
}

export { isStoppedTerminalError };

export function typedTurnEndStatus(cancelRequested: boolean, terminalError: string | null): string {
  if (cancelRequested) return 'Stopped.';
  if (terminalError) return `Task hit a problem: ${actionableErrorCopy(terminalError)}`;
  return 'Done — type another task.';
}
