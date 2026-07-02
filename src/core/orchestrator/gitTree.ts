// src/main/gitTree.ts — "is the working tree clean?" guard for confirmed-destructive runs.
// A destructive op (rm -rf, reset --hard, …) is only allowed to proceed when git can undo it, so we
// require a clean tree first. The git runner is injected so the policy is unit-testable; an error
// (not a repo / git missing) is treated as NOT clean — fail safe, deny the run.
import { execFile } from 'node:child_process';

export type GitRunner = (repo: string) => Promise<string>;

// execFile (no shell) with a fixed argv — repo is only the cwd, never interpolated into a command.
const defaultRunner: GitRunner = (repo) =>
  new Promise<string>((resolve, reject) => {
    execFile('git', ['status', '--porcelain'], { cwd: repo, timeout: 5_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });

export async function isCleanTree(repo: string, run: GitRunner = defaultRunner): Promise<boolean> {
  try {
    return (await run(repo)).trim() === '';
  } catch {
    return false; // can't determine -> treat as dirty so the destructive run is denied
  }
}
