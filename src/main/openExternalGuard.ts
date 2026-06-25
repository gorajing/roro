// src/main/openExternalGuard.ts — the allowlist for shell.openExternal.
//
// shell.openExternal will happily open file://, custom schemes, and arbitrary hosts — a classic Electron
// privilege-escalation / phishing vector if a (possibly compromised) renderer controls the URL. Roro opens
// exactly ONE external place: the Ollama download page. So the gate is strict — https + ollama.com only.

export function isAllowedExternalUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false; // not a parseable URL
  }
  return u.protocol === 'https:' && /(^|\.)ollama\.com$/.test(u.hostname);
}
