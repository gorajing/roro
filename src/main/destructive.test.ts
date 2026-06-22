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
  });

  it('does NOT flag a single-file rm or a natural-language "remove"', () => {
    expect(D('rm build/tmp.txt')).toBe(false);
    expect(D('remove the unused import in app.ts')).toBe(false);
  });

  it('flags force/mirror push and history rewrite', () => {
    expect(D('git push --force origin main')).toBe(true);
    expect(D('git push -f')).toBe(true);
    expect(D('git push --mirror backup')).toBe(true);
    expect(D('git filter-branch --tree-filter rm secrets')).toBe(true);
    expect(D('run git filter-repo to purge secrets')).toBe(true);
  });

  it('flags git reset --hard', () => {
    expect(D('git reset --hard HEAD~3')).toBe(true);
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
