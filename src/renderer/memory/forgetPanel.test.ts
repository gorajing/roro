// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountForgetPanel } from './forgetPanel';
import type { ProfileFactSourceView, ProfileFactView } from '../../shared/memory';
import type { MemoryHealthStatusMsg } from '../../shared/ipc';

interface Stub {
  profile: ReturnType<typeof vi.fn>;
  fixFact: ReturnType<typeof vi.fn>;
  verifyFact: ReturnType<typeof vi.fn>;
  factSource: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
}

interface CompanionStub {
  getMemoryHealthStatus: ReturnType<typeof vi.fn>;
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

function setup(facts: ProfileFactView[] = [], memoryHealth: MemoryHealthStatusMsg | null = null): Stub {
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
  (window as unknown as { companion: CompanionStub }).companion = {
    getMemoryHealthStatus: vi.fn().mockResolvedValue(memoryHealth),
  };
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

  it('can render against injected smoke deps without the preload memory bridge', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    delete (window as unknown as { memory?: Stub }).memory;
    const profile = vi.fn().mockResolvedValue([fact('a', 'prefers vim')]);

    mountForgetPanel(undefined, {
      memory: {
        profile,
        fixFact: vi.fn(),
        verifyFact: vi.fn(),
        factSource: vi.fn(),
        forget: vi.fn(),
      },
      companion: {
        getMemoryHealthStatus: vi.fn().mockResolvedValue(null),
      },
    });
    click(q('#memory-toggle'));
    await flush();

    expect(profile).toHaveBeenCalledOnce();
    expect(q('.memory-text')?.textContent).toBe('prefers vim');
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

  it('keeps Source focused after opening and Escape closes the detail', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-source'));
    await flush();
    await flush();

    const detail = q('.memory-source-detail') as HTMLElement;
    const source = q('.memory-source') as HTMLButtonElement;
    expect(stub.factSource).toHaveBeenCalledWith('a');
    expect(detail).toBeTruthy();
    expect(detail.id).toBe(source.getAttribute('aria-controls'));
    expect(source.getAttribute('aria-expanded')).toBe('true');
    expect(source.getAttribute('aria-describedby')?.split(/\s+/)).toEqual([q('.memory-text')?.id, detail.id]);
    expect(detail.getAttribute('tabindex')).toBeNull();
    expect(detail.getAttribute('aria-label')).toBeNull();
    expect(detail.textContent).toContain('No transcript is shown here.');
    expect(source.nextElementSibling?.classList.contains('memory-forget')).toBe(true);
    expect(document.activeElement).toBe(source);

    source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(q('.memory-source-detail')).toBeNull();
    expect(document.activeElement).toBe(q('.memory-source'));
    expect(q('.memory-source')?.getAttribute('aria-expanded')).toBe('false');
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

  it('restores focus to Fix after canceling an edit with Escape or Cancel', async () => {
    setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-fix'));
    expect(document.activeElement).toBe(q('.memory-edit-input'));

    q('.memory-edit-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(q('.memory-edit-input')).toBeNull();
    expect(document.activeElement).toBe(q('.memory-fix'));

    click(q('.memory-fix'));
    expect(document.activeElement).toBe(q('.memory-edit-input'));
    click(q('.memory-cancel'));
    await flush();

    expect(q('.memory-edit-input')).toBeNull();
    expect(document.activeElement).toBe(q('.memory-fix'));
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
    expect(document.activeElement).toBe(q('#memory-toggle'));
  });

  it('moves focus to the next row after forgetting one of several memories', async () => {
    const stub = setup([fact('a', 'prefers vim'), fact('b', 'uses tabs')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    const firstForget = document.querySelector('.memory-row .memory-forget') as HTMLButtonElement;
    click(firstForget);
    click(firstForget);
    await flush();
    await flush();

    expect(stub.forget).toHaveBeenCalledWith('a');
    expect([...document.querySelectorAll('.memory-text')].map((row) => row.textContent)).toEqual(['uses tabs']);
    expect(document.activeElement).toBe(q('.memory-row .memory-verify'));
  });

  it('restores focus to Fix after saving an edited memory', async () => {
    const stub = setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    click(q('.memory-fix'));
    const input = q('.memory-edit-input') as HTMLInputElement;
    input.value = 'prefers zed';
    input.dispatchEvent(new Event('input'));
    click(q('.memory-save'));
    await flush();
    await flush();

    expect(stub.fixFact).toHaveBeenCalledWith('a', 'prefers zed');
    expect(q('.memory-text')?.textContent).toBe('prefers zed');
    expect(document.activeElement).toBe(q('.memory-fix'));
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

  it('uses memory health to explain a Keychain-paused profile failure', async () => {
    const stub = setup([], {
      state: 'degraded',
      checkedAt: 1,
      reason: 'keychain-unavailable',
      message: 'Roro cannot reach the OS keychain.',
    });
    stub.profile.mockRejectedValueOnce(new Error('Keychain Not Found'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();

    const text = q('.memory-error')?.textContent ?? '';
    expect(text).toMatch(/Local memory is paused/);
    expect(text).toMatch(/Roro can still code/);
    expect(text).toMatch(/macOS Keychain/);
    expect(text).not.toMatch(/cloud|API key/i);
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

  it('Escape closes the panel and restores focus to the toggle', async () => {
    setup([fact('a', 'prefers vim')]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(false);

    q('#memory-panel')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect((q('#memory-panel') as HTMLElement).hidden).toBe(true);
    expect(q('#memory-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(q('#memory-toggle'));
  });

  it('ships visible focus styles for every Memory panel keyboard target', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const selectors = [
      '#memory-toggle:focus-visible',
      '.memory-verify:focus-visible',
      '.memory-fix:focus-visible',
      '.memory-source:focus-visible',
      '.memory-forget:focus-visible',
      '.memory-save:focus-visible',
      '.memory-cancel:focus-visible',
      '.memory-edit-input:focus-visible',
    ];

    for (const selector of selectors) expect(css).toContain(selector);
    expect(css).toMatch(/focus-visible[\s\S]*outline\s*:\s*(?!none)/);
    expect(css).toMatch(/focus-visible[\s\S]*outline-offset\s*:/);
  });

  it('unmount removes the toggle and panel', () => {
    setup();
    const unmount = mountForgetPanel();
    unmount();
    expect(q('#memory-toggle')).toBeNull();
    expect(q('#memory-panel')).toBeNull();
  });
});
