import { describe, it, expect } from 'vitest';
import { classifyDestructive } from './destructive';

const D = (task: string): boolean => classifyDestructive(task).destructive;

describe('classifyDestructive', () => {
  it('flags recursive removes (rm -r / -rf / -fr / separate flags)', () => {
    expect(D('rm -rf build')).toBe(true);
    expect(D('rm -fr node_modules')).toBe(true);
    expect(D('sudo rm -rf /')).toBe(true);
    expect(D('please run: rm -r -f dist')).toBe(true);
    expect(D('rm -R coverage')).toBe(true);
    expect(D('rm -f -r build')).toBe(true); // force before recursive
    expect(D('rm --force --recursive build')).toBe(true); // long flags, separate tokens
    expect(D('rm --recursive node_modules')).toBe(true);
    expect(D('rm "-rf" build')).toBe(true); // shell-quoted flag
    expect(D("rm '-r' build")).toBe(true);
  });

  it('does NOT flag a single-file rm or a natural-language "remove"', () => {
    expect(D('rm build/tmp.txt')).toBe(false);
    expect(D('remove the unused import in app.ts')).toBe(false);
  });

  it('flags force/mirror push and history rewrite (incl. global options + +refspec)', () => {
    expect(D('git push --force origin main')).toBe(true);
    expect(D('git push -f')).toBe(true);
    expect(D('git push --mirror backup')).toBe(true);
    expect(D('git push origin +main')).toBe(true); // +refspec force syntax (no --force)
    expect(D('git push origin +HEAD:main')).toBe(true);
    expect(D('git -C . push --force origin main')).toBe(true); // global -C option before subcommand
    expect(D('git filter-branch --tree-filter rm secrets')).toBe(true);
    expect(D('run git filter-repo to purge secrets')).toBe(true);
  });

  it('flags git reset --hard (incl. global options)', () => {
    expect(D('git reset --hard HEAD~3')).toBe(true);
    expect(D('git -C /repo reset --hard origin/main')).toBe(true);
  });

  it('flags git clean -f variants but not the -n dry-run', () => {
    expect(D('git clean -fd')).toBe(true);
    expect(D('git clean -ffdx')).toBe(true);
    expect(D('git clean -n')).toBe(false); // dry-run, safe
    expect(D('git clean -d')).toBe(false); // no -f -> no-op
  });

  it('does NOT flag an ordinary git push', () => {
    expect(D('git push origin main')).toBe(false);
    expect(D('commit and push the fix')).toBe(false);
  });

  it('flags SQL drop / truncate', () => {
    expect(D('DROP TABLE users')).toBe(true);
    expect(D('truncate orders')).toBe(true);
    expect(D('drop database prod')).toBe(true);
  });

  it('flags dd / mkfs', () => {
    expect(D('dd if=/dev/zero of=/dev/sda bs=1M')).toBe(true);
    expect(D('mkfs.ext4 /dev/sdb1')).toBe(true);
  });

  it('flags writes to home / system locations (outside the workspace)', () => {
    expect(D('edit ~/.bashrc to add an alias')).toBe(true);
    expect(D('append a line to /etc/hosts')).toBe(true);
    expect(D('write /usr/local/bin/foo')).toBe(true);
  });

  it('does NOT flag ordinary in-repo tasks or URL routes (avoid alarm fatigue)', () => {
    expect(D('add a GET /health route and a focused test')).toBe(false); // URL route, not a fs path
    expect(D('fix the failing test in src/calc.ts')).toBe(false);
    expect(D('run the test suite')).toBe(false);
    expect(D('refactor the auth middleware')).toBe(false);
  });

  it('returns a human reason on a hit', () => {
    const r = classifyDestructive('rm -rf build');
    expect(r.destructive).toBe(true);
    expect(typeof r.reason === 'string' && r.reason.length > 0).toBe(true);
  });
});
