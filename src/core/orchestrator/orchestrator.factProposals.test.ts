import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ActionEvent } from '../../shared/events';

// WIRING coverage for the executor-facts pilot (the locate-gate lesson: a feature's single
// connecting line in the orchestrator must have its own test, or a refactor deletes it green).
// Pins: (a) flag on + run.completed -> exactly one proposal ask with a digest built ONLY from the
// dispatched prompt + the executor's own events; (b) flag off -> no ask; (c) run.failed -> no ask.

const h = vi.hoisted(() => ({
  memory: {
    remember: vi.fn(), recall: vi.fn(), getProfile: vi.fn(), supersede: vi.fn(),
    traceExtraction: vi.fn(), profileFacts: vi.fn(async () => []),
  },
  brain: { decide: vi.fn(), describeScreen: vi.fn(), groundTarget: vi.fn(), embed: vi.fn(), extractFact: vi.fn(async () => null) },
  vision: { captureScreen: vi.fn(), askScreen: vi.fn() },
  run: vi.fn(),
  maybeProposeFacts: vi.fn(async () => undefined),
}));

vi.mock('./siblings', () => ({ loadBrain: async () => h.brain, loadMemory: async () => h.memory, loadVision: async () => h.vision }));
vi.mock('./identity', () => ({ getOwnerId: () => 'owner-test' }));
vi.mock('./workdir', () => ({ resolveWorkdir: () => '/tmp/fake-repo', tryResolveWorkdir: () => '/tmp/fake-repo' }));
vi.mock('../executor', () => ({ getExecutor: () => ({ run: h.run }) }));
vi.mock('./factProposals', () => ({
  maybeProposeFacts: h.maybeProposeFacts,
  executorProposalSource: vi.fn(() => ({ propose: vi.fn() })),
}));

import { installTestPorts, resetTestPorts } from '../ports/testing';
import { runTask } from './orchestrator';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

function fakeStream(events: Partial<ActionEvent>[]): void {
  h.run.mockImplementation(async function* () {
    for (const e of events) yield { runId: 'exec_run', ts: 1, ...e } as ActionEvent;
  });
}

const COMPLETED_STREAM: Partial<ActionEvent>[] = [
  { kind: 'run.started', agent: 'codex' },
  { kind: 'command', itemId: 'i1', status: 'started', command: 'npm test' },
  { kind: 'message', text: 'All green.' },
  { kind: 'run.completed', ok: true, finalText: 'Done — kept tests beside the feature.' },
];

describe('orchestrator wiring — executor-facts pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installTestPorts();
    h.memory.recall.mockResolvedValue([]);
    h.memory.getProfile.mockResolvedValue([]);
    h.memory.remember.mockImplementation(async (i: Record<string, unknown>) => ({ id: 'x', ...i, superseded: false, created_at: 't' }));
    process.env.RORO_EXECUTOR_FACTS = '1';
  });
  afterEach(() => {
    resetTestPorts();
    delete process.env.RORO_EXECUTOR_FACTS;
  });

  it('flag ON + run.completed: fires exactly one ask with a provider-visible-only digest', async () => {
    fakeStream(COMPLETED_STREAM);
    await runTask('add a logout route', 'codex');
    await flush();

    expect(h.maybeProposeFacts).toHaveBeenCalledTimes(1);
    const digest = (h.maybeProposeFacts.mock.calls as unknown as [[Record<string, unknown>]])[0][0];
    expect(digest).toMatchObject({
      task: 'add a logout route',
      outcome: 'completed',
      agent: 'codex',
      repo: '/tmp/fake-repo',
      commands: ['npm test'],
      messages: ['All green.'],
      finalText: 'Done — kept tests beside the feature.',
    });
    // Privacy pin: the digest carries NO transcript/narration/memory fields whatsoever.
    expect(Object.keys(digest).sort()).toEqual(
      ['agent', 'commands', 'files', 'finalText', 'messages', 'outcome', 'repo', 'runId', 'sessionId', 'task'],
    );
  });

  it('flag OFF: no digest, no ask', async () => {
    delete process.env.RORO_EXECUTOR_FACTS;
    fakeStream(COMPLETED_STREAM);
    await runTask('add a logout route', 'codex');
    await flush();
    expect(h.maybeProposeFacts).not.toHaveBeenCalled();
  });

  it('run.failed: never asks (a failed run teaches about the repo, not the user)', async () => {
    fakeStream([
      { kind: 'run.started', agent: 'codex' },
      { kind: 'run.failed', ok: false, error: 'boom' },
    ]);
    await runTask('add a logout route', 'codex');
    await flush();
    expect(h.maybeProposeFacts).not.toHaveBeenCalled();
  });
});
