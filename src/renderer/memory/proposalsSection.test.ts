// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountProposalsSection, type ProposalsBridge } from './proposalsSection';
import type { FactProposalView } from '../../main/factProposals/types';

const ROW: FactProposalView = {
  id: 'prop_1', key: 'tests_location', value: 'keeps tests beside features',
  evidence: 'keeps tests beside features', agent: 'codex', createdAt: 1,
};

function bridge(over: Partial<ProposalsBridge> = {}): ProposalsBridge {
  return {
    proposals: vi.fn(async () => [ROW]),
    resolveProposal: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

describe('proposalsSection — review surface (nothing stores without Save)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders proposals with the claiming agent NAMED and the evidence quote shown', async () => {
    const b = bridge();
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    const section = host.querySelector('#memory-proposals') as HTMLElement;
    expect(section.hidden).toBe(false);
    expect(section.textContent).toContain('tests location: keeps tests beside features');
    expect(section.textContent).toContain('codex noticed this during a coding run');
    expect(section.textContent).toContain('keeps tests beside features');
  });

  it('stays hidden and inert when the bridge rejects (flag off — handlers unregistered)', async () => {
    const b = bridge({ proposals: vi.fn(async () => { throw new Error('No handler registered'); }) });
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    expect((host.querySelector('#memory-proposals') as HTMLElement).hidden).toBe(true);
  });

  it('Save resolves accept=true and re-renders from the queue truth', async () => {
    const b = bridge();
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    vi.mocked(b.proposals).mockResolvedValue([]); // after resolve, the queue is empty
    (host.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(b.resolveProposal).toHaveBeenCalledWith('prop_1', true);
    expect((host.querySelector('#memory-proposals') as HTMLElement).hidden).toBe(true);
  });

  it('"Not for me" resolves accept=false', async () => {
    const b = bridge();
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    (host.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(b.resolveProposal).toHaveBeenCalledWith('prop_1', false);
  });

  it('a failing Save is recoverable in place — buttons re-enable, row stays, retry copy shows', async () => {
    const b = bridge({ resolveProposal: vi.fn(async () => { throw new Error('db down'); }) });
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    const save = host.querySelectorAll('button')[0] as HTMLButtonElement;
    save.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(save.disabled).toBe(false);
    expect(host.textContent).toContain("Couldn't save. Retry.");
    expect(host.textContent).toContain('tests location'); // the row did not vanish
  });

  it('renders via textContent only — a hostile value cannot inject markup', async () => {
    const hostile = { ...ROW, value: '<img src=x onerror=alert(1)>' };
    const b = bridge({ proposals: vi.fn(async () => [hostile]) });
    const { refresh } = mountProposalsSection(host, { bridge: b });
    await refresh();
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('sourceSummary — executor provenance is NAMED, never misattributed (spec decision 6)', () => {
  it('renders who claimed it, the confirmation, and the evidence quote', async () => {
    const { __test } = await import('./forgetPanel');
    const copy = __test.sourceSummary({
      session_id: 's1', turn_ts: Date.parse('2026-07-01T12:00:00Z'),
      channel: 'executor', claimed_by: 'codex', evidence: 'keeps tests beside features',
    });
    expect(copy).toContain('codex suggested this after a coding run');
    expect(copy).toContain('you confirmed it');
    expect(copy).toContain('keeps tests beside features');
    expect(copy).not.toContain('Saved from a local Roro turn');
  });

  it('an ordinary 3B fact keeps the local-turn copy', async () => {
    const { __test } = await import('./forgetPanel');
    const copy = __test.sourceSummary({ session_id: 's1', turn_ts: Date.parse('2026-07-01T12:00:00Z') });
    expect(copy).toContain('Saved from a local Roro turn');
  });
});
