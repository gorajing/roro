// src/main/destructive.ts — a small, high-confidence classifier for tasks that need an explicit
// confirm before the coding agent runs them. PURE + conservative-by-DESIGN toward the SAFE failure:
// a false positive is one extra confirm click; a false negative could run `rm -rf` unconfirmed. But
// it deliberately does NOT flag URL routes / in-repo paths — over-flagging breeds alarm fatigue and
// makes the gate worthless. Finer "outside workdir()" detection is approximated by home/system roots
// (free-text path parsing can't reliably tell "/health" the route from "/health" the file).

export interface DestructiveVerdict {
  destructive: boolean;
  /** Human-readable reason, present when destructive. */
  reason?: string;
}

const PATTERNS: Array<{ re: RegExp; reason: string }> = [
  // rm with a recursive flag in ANY of its leading flag tokens (-r / -rf / -fr / -f -r /
  // --recursive), tolerating shell quotes around a flag (rm "-rf" / rm '-r'). The flag tokens must
  // be contiguous after `rm` so an unrelated later `-r…` in prose doesn't false-flag.
  { re: /\brm(?:\s+['"]?-\S+)*\s+['"]?-\S*r/i, reason: 'recursive file deletion (rm -r)' },
  // Force/mirror push, INCLUDING the `+refspec` force syntax (git push origin +main) which rewrites
  // remote refs with no --force flag. The git prefix tolerates global options (git -C <path>, -c
  // <kv>, …) before the subcommand so `git -C . push --force` doesn't slip through.
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|--mirror\b|\s-f(?:\s|$)|\s\+[\w/])/i, reason: 'force/mirror git push (rewrites history)' },
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+reset\b[^\n]*--hard/i, reason: 'git reset --hard (discards local changes)' },
  { re: /\b(?:filter-branch|filter-repo)\b/i, reason: 'git history rewrite' },
  { re: /\bdrop\s+(?:table|database|schema)\b/i, reason: 'SQL DROP (data loss)' },
  { re: /\btruncate\s+(?:table\s+)?\w/i, reason: 'SQL TRUNCATE (data loss)' },
  { re: /\bdd\s+(?:if|of)=/i, reason: 'raw disk write (dd)' },
  { re: /\bmkfs(?:\.\w+)?\b/i, reason: 'filesystem format (mkfs)' },
  { re: /(?:^|\s)~\//, reason: 'touches a home-directory path outside the workspace' },
  { re: /(?:^|\s)\/(?:etc|usr|bin|sbin|var|dev|System|Library|opt|boot|root|private)\b/i, reason: 'touches a system path outside the workspace' },
];

export function classifyDestructive(task: string): DestructiveVerdict {
  for (const { re, reason } of PATTERNS) {
    if (re.test(task)) return { destructive: true, reason };
  }
  return { destructive: false };
}
