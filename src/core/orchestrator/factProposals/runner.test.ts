import { describe, expect, it, vi } from 'vitest';
import { cancelAllProposers, maybeProposeFacts, type ProposeDeps, type ProposeTrace } from './runner';
import { createPendingQueue } from './pendingQueue';
import type { ProposalSource, RunDigest } from './index';

const digest: RunDigest = {
  runId: 'r1', sessionId: 's1', repo: '/tmp/repo', agent: 'codex',
  task: 'add a logout route', outcome: 'completed',
  finalText: 'Added the route. The project keeps tests beside features.',
  commands: [], files: [], messages: [],
};

const GOOD_REPLY = JSON.stringify([
  { key: 'tests_location', value: 'keeps tests beside features', evidence: 'keeps tests beside features' },
]);

function harness(source: ProposalSource, over: Partial<ProposeDeps> = {}) {
  const traces: ProposeTrace[] = [];
  const queue = createPendingQueue();
  const notify = vi.fn();
  const deps: ProposeDeps = {
    source,
    queue,
    getExisting: async () => [],
    notify,
    trace: (e) => traces.push(e),
    ...over,
  };
  return { deps, traces, queue, notify };
}

describe('maybeProposeFacts — fire-and-forget, single-slot, never disturbs the turn', () => {
  it('happy path: ask -> parse -> admit -> queue -> notify, with asked/queued traces', async () => {
    const { deps, traces, queue, notify } = harness({ propose: async () => GOOD_REPLY });
    await maybeProposeFacts(digest, deps);
    expect(queue.list().map((p) => p.key)).toEqual(['tests_location']);
    expect(notify).toHaveBeenCalledWith(1);
    expect(traces.map((t) => t.stage)).toEqual(['asked', 'queued']);
    expect(traces[1].keys).toEqual(['tests_location']);
  });

  it('a throwing source is caught and traced failed — queue untouched, notify never fires', async () => {
    const { deps, traces, queue, notify } = harness({ propose: async () => { throw new Error('CLI exploded'); } });
    await expect(maybeProposeFacts(digest, deps)).resolves.toBeUndefined();
    expect(queue.list()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(traces.at(-1)).toMatchObject({ stage: 'failed', reason: expect.stringContaining('CLI exploded') });
  });

  it('a hung source is aborted by the timeout and traced failed', async () => {
    const never: ProposalSource = {
      propose: (_d, signal) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted by timeout')));
      }),
    };
    const { deps, traces, queue } = harness(never, { timeoutMs: 20 });
    await maybeProposeFacts(digest, deps);
    expect(traces.at(-1)?.stage).toBe('failed');
    expect(queue.list()).toEqual([]);
  });

  it('SINGLE SLOT: a run completing while an ask is in flight skips with skipped_busy', async () => {
    let release!: (v: string) => void;
    const slow: ProposalSource = { propose: () => new Promise((res) => { release = res; }) };
    const first = harness(slow);
    const p1 = maybeProposeFacts(digest, first.deps);

    const second = harness({ propose: async () => GOOD_REPLY });
    await maybeProposeFacts({ ...digest, runId: 'r2' }, second.deps);
    expect(second.traces).toEqual([{ stage: 'skipped_busy', runId: 'r2', agent: 'codex' }]);
    expect(second.queue.list()).toEqual([]);

    release(GOOD_REPLY);
    await p1;
    expect(first.queue.list()).toHaveLength(1); // the slot frees and the first ask still lands
  });

  it('an empty [] reply (null discipline SUCCESS) queues nothing and does not notify', async () => {
    const { deps, queue, notify, traces } = harness({ propose: async () => '[]' });
    await maybeProposeFacts(digest, deps);
    expect(queue.list()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(traces.at(-1)).toMatchObject({ stage: 'malformed', reason: 'empty' });
  });

  it('memory down at dedupe (getExisting rejects) still admits — confirm is the real gate', async () => {
    const { deps, queue } = harness({ propose: async () => GOOD_REPLY }, { getExisting: async () => { throw new Error('db down'); } });
    await maybeProposeFacts(digest, deps);
    expect(queue.list()).toHaveLength(1);
  });

  it('cancelAllProposers aborts an in-flight ask (will-quit path)', async () => {
    const hung: ProposalSource = {
      propose: (_d, signal) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('killed on quit')));
      }),
    };
    const { deps, traces } = harness(hung);
    const p = maybeProposeFacts(digest, deps);
    cancelAllProposers();
    await p;
    expect(traces.at(-1)).toMatchObject({ stage: 'failed', reason: expect.stringContaining('killed on quit') });
  });
});
