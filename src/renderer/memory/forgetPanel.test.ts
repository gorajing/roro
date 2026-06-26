// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountForgetPanel } from './forgetPanel';
import type { ProfileFactSourceView, ProfileFactView } from '../../shared/memory';

interface Stub {
  profile: ReturnType<typeof vi.fn>;
  fixFact: ReturnType<typeof vi.fn>;
  verifyFact: ReturnType<typeof vi.fn>;
  factSource: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
}

function fact(id: string, text: string, over: Partial<ProfileFactView> = {}): ProfileFactView {
  return {
    id,
    key: over.key ?? id,
    value: over.value ?? text,
    text,
    created_at: over.created_at ?? '2026-06-21T00:00:00Z',
    source: over.source,
    confidence: over.confidence,
  };
}

function setup(facts: ProfileFactView[] = []): Stub {
  document.body.innerHTML = '<div id="app"></div>';
  const stub: Stub = {
    profile: vi.fn().mockResolvedValue(facts),
    fixFact: vi.fn().mockImplementation(async (id: string, value: string) => fact(`${id}-fixed`, value)),
    verifyFact: vi.fn().mockImplementation(async (id: string) => facts.find((row) => row.id === id) ?? fact(id, 'missing')),
    factSource: vi.fn().mockImplementation(async (id: string): Promise<ProfileFactSourceView> => ({
      id,
      source: { session_id: 'sess-1', turn_ts: 1718900000000 },
    })),
    forget: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { memory: Stub }).memory = stub;
  return stub;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (sel: string): HTMLElement | null => document.querySelector(sel);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

describe('mountForgetPanel — memory trust loop', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders a closed toggle; the panel is hidden until opened', () => {
    setup();
    mountForgetPanel();
    expect(q('#memory-toggle')?.textContent).toBe('What Roro remembers');
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(true);
    expect(q('#memory-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opening fetches the profile and lists each fact', async () => {
    const stub = setup([fact('a', 'prefers vim'), fact('b', 'uses tabs')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(stub.profile).toHaveBeenCalledOnce();
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(false);
    expect(q('#memory-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('.memory-row')].map((r) => r.querySelector('.memory-text')?.textContent))
      .toEqual(['prefers vim', 'uses tabs']);
  });

  it('verifies a memory through Looks right and keeps the row retryable on failure', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    stub.verifyFact.mockRejectedValueOnce(new Error('IPC down')).mockResolvedValueOnce(fact('a', 'prefers vim'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    const verify = q('.memory-verify') as HTMLButtonElement;
    click(verify);
    await flush();
    expect(stub.verifyFact).toHaveBeenCalledWith('a');
    expect(q('.memory-row')).toBeTruthy();
    expect(q('.memory-row-note')?.textContent).toMatch(/couldn.t check/i);

    click(q('.memory-verify'));
    await flush();
    expect(q('.memory-row-note')?.textContent).toBe('Checked just now.');
  });

  it('fixes a wrong memory inline and replaces the visible row with the returned fact', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-fix'));
    const input = q('.memory-edit-input') as HTMLInputElement;
    const save = q('.memory-save') as HTMLButtonElement;
    expect(input.value).toBe('prefers vim');
    expect(save.disabled).toBe(true);

    input.value = 'prefers zed';
    input.dispatchEvent(new Event('input'));
    expect(save.disabled).toBe(false);
    click(save);
    await flush();

    expect(stub.fixFact).toHaveBeenCalledWith('a', 'prefers zed');
    expect(q('.memory-text')?.textContent).toBe('prefers zed');
    expect(q('.memory-row-note')?.textContent).toBe('Saved.');
  });

  it('failed fix keeps the edit row open and says the old memory is unchanged', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    stub.fixFact.mockRejectedValueOnce(new Error('embed down'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-fix'));
    const input = q('.memory-edit-input') as HTMLInputElement;
    input.value = 'prefers zed';
    input.dispatchEvent(new Event('input'));
    click(q('.memory-save'));
    await flush();

    expect(q('.memory-edit-input')).toBeTruthy();
    expect(q('.memory-row-error')?.textContent).toMatch(/old memory is unchanged/i);
    expect((q('.memory-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('source renders safe local metadata with textContent and no transcript viewer', async () => {
    const stub = setup([fact('a', '<img src=x onerror=alert(1)>')]);
    stub.factSource.mockResolvedValueOnce({
      id: 'a',
      source: { session_id: '<b>session</b>', turn_ts: 1718900000000 },
    });
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-source'));
    await flush();

    expect(stub.factSource).toHaveBeenCalledWith('a');
    expect(q('.memory-text')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('.memory-row img')).toBeNull();
    expect(q('.memory-source-detail')?.textContent).toContain('No transcript is shown here.');
    expect(q('.memory-source-session')?.textContent).toBe('Session: <b>session</b>');
    expect(document.querySelector('.memory-source-session b')).toBeNull();
  });

  it('source failure keeps the row visible and retryable', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    stub.factSource.mockRejectedValueOnce(new Error('missing source'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-source'));
    await flush();

    expect(q('.memory-row')).toBeTruthy();
    expect(q('.memory-row-error')?.textContent).toMatch(/source.*retry/i);
    expect((q('.memory-source') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Forget is a deliberate 2-step: the first click arms, the second confirms', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    const btn = q('.memory-row .memory-forget');
    click(btn);
    expect(stub.forget).not.toHaveBeenCalled();
    expect(btn?.textContent).toMatch(/forever/i);
    click(btn);
    await flush();
    expect(stub.forget).toHaveBeenCalledWith('a');
    expect(q('.memory-row')).toBeNull();
  });

  it('fails loud when forget rejects and keeps the row', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    stub.forget.mockRejectedValueOnce(new Error('disk full'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    const btn = q('.memory-row .memory-forget') as HTMLButtonElement;
    click(btn);
    click(btn);
    await flush();
    expect(q('.memory-row')).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/forget.*retry/i);
  });

  it('shows an empty state when Roro has not saved facts', async () => {
    setup([]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(q('.memory-empty')?.textContent).toMatch(/hasn.t saved/i);
  });

  it('fails loud-but-friendly when profile rejects', async () => {
    const stub = setup();
    stub.profile.mockRejectedValueOnce(new Error('IPC down'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(q('.memory-error')?.textContent).toMatch(/couldn.t open/i);
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(false);
    expect(q('.memory-row')).toBeNull();
  });

  it('recovers on reopen after a failed load', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    stub.profile.mockRejectedValueOnce(new Error('IPC down'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(q('.memory-error')).toBeTruthy();
    click(q('#memory-toggle'));
    click(q('#memory-toggle'));
    await flush();
    expect(q('.memory-error')).toBeNull();
    expect(q('.memory-text')?.textContent).toBe('prefers vim');
    expect(stub.profile).toHaveBeenCalledTimes(2);
  });

  it('unmount removes the toggle and panel', () => {
    setup();
    const unmount = mountForgetPanel();
    unmount();
    expect(q('#memory-toggle')).toBeNull();
    expect(q('#memory-panel')).toBeNull();
  });
});
