// src/main/destructive.ts — a small, high-confidence classifier for tasks that need an explicit
// confirm before the coding agent runs them. PURE + conservative-by-DESIGN toward the SAFE failure:
// a false positive is one extra confirm click; a false negative could run `rm -rf` unconfirmed. But
// it deliberately does NOT flag URL routes / in-repo paths — over-flagging breeds alarm fatigue and
// makes the gate worthless. Finer "outside workdir()" detection is approximated by home/system roots
// (free-text path parsing can't reliably tell "/health" the route from "/health" the file).
//
// ARCHITECTURAL LIMIT (defense-in-depth, NOT a sandbox): this inspects the TASK PROMPT, not the
// agent's actual argv at execution. A paraphrased/obfuscated instruction can evade it, and an agent
// can still emit a destructive command MID-RUN unguarded. True enforcement would gate at command
// emission (the `command` ActionEvent), aborting the run on a destructive argv — tracked as a
// follow-up. The high-confidence set below is the cheap, alarm-fatigue-free first line.

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
  // Force/mirror/DELETE push, INCLUDING the `+refspec` force syntax (git push origin +main) which
  // rewrites remote refs with no --force flag. The git prefix tolerates global options (git -C
  // <path>, -c <kv>, …) before the subcommand so `git -C . push --force` doesn't slip through.
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|--mirror\b|--delete\b|\s-f(?:\s|$)|\s-d(?:\s|$)|\s\+[\w/])/i, reason: 'force/mirror/delete git push (rewrites or removes remote refs)' },
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+reset\b[^\n]*--hard/i, reason: 'git reset --hard (discards local changes)' },
  // git clean with -f (and usually -d/-x) deletes untracked/ignored files — irreversible (they were
  // never in git). Requires -f (without it, clean is a no-op); a -n dry-run is safe and not flagged.
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+clean\b[^\n]*-\S*f/i, reason: 'git clean -f (deletes untracked files)' },
  // git branch -D force-deletes a local branch, losing unmerged commits (lowercase -d is safe).
  { re: /\bgit(?:\s+-[Cc]\s+\S+|\s+-\S+)*\s+branch\b[^\n]*\s-D\b/, reason: 'git branch -D (force-deletes a branch, losing unmerged commits)' },
  // find ... -delete / -exec rm removes matched files irreversibly.
  { re: /\bfind\b[^\n]*\s-delete\b/i, reason: 'find -delete (bulk irreversible deletion)' },
  { re: /\bfind\b[^\n]*-exec\s+rm\b/i, reason: 'find -exec rm (bulk deletion)' },
  // shred / wipe overwrite-destroys file contents.
  { re: /\bshred\b/i, reason: 'shred (irreversibly destroys file contents)' },
  // A raw block device path (/dev/sda, /dev/sdb1, /dev/nvme0n1, /dev/disk2, …) — writing it corrupts
  // the disk. Match the device-name PREFIX (no trailing \b: the node always carries an index char, so
  // \b would never fire). None of the safe character devices (/dev/null, /dev/stdout, /dev/zero, …)
  // start with these prefixes, so prefix-matching does not cause alarm fatigue.
  { re: /\/dev\/(?:sd|nvme|disk|rdisk|hd)/i, reason: 'raw block device (sd/nvme/disk) — corrupts the disk' },
  { re: /\b(?:filter-branch|filter-repo)\b/i, reason: 'git history rewrite' },
  { re: /\bdrop\s+(?:table|database|schema)\b/i, reason: 'SQL DROP (data loss)' },
  { re: /\btruncate\s+(?:table\s+)?\w/i, reason: 'SQL TRUNCATE (data loss)' },
  { re: /\bdd\s+(?:if|of)=/i, reason: 'raw disk write (dd)' },
  { re: /\bmkfs(?:\.\w+)?\b/i, reason: 'filesystem format (mkfs)' },
  { re: /(?:^|\s)~\//, reason: 'touches a home-directory path outside the workspace' },
  // NB: /dev is intentionally NOT in this generic list — raw-disk writes are caught by the specific
  // raw-block-device pattern above, while the safe character devices (/dev/null, /dev/stdout,
  // /dev/stderr) are extremely common redirect targets and must not trip the gate (alarm fatigue).
  { re: /(?:^|\s)\/(?:etc|usr|bin|sbin|var|System|Library|opt|boot|root|private)\b/i, reason: 'touches a system path outside the workspace' },
];

export function classifyDestructive(task: string): DestructiveVerdict {
  for (const { re, reason } of PATTERNS) {
    if (re.test(task)) return { destructive: true, reason };
  }
  return { destructive: false };
}
