// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountForgetPanel } from './forgetPanel';

interface Stub { profile: ReturnType<typeof vi.fn>; forget: ReturnType<typeof vi.fn> }

function setup(facts: Array<{ id: string; text: string }> = []): Stub {
  document.body.innerHTML = '<div id="app"></div>';
  const stub: Stub = {
    profile: vi.fn().mockResolvedValue(facts),
    forget: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { memory: Stub }).memory = stub;
  return stub;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (sel: string): HTMLElement | null => document.querySelector(sel);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

describe('mountForgetPanel — see + forget what Roro knows', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders a closed toggle; the panel is hidden until opened', () => {
    setup();
    mountForgetPanel();
    expect(q('#memory-toggle')).toBeTruthy();
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(true);
  });

  it('opening fetches the profile and lists each fact', async () => {
    const stub = setup([{ id: 'a', text: 'prefers vim' }, { id: 'b', text: 'uses tabs' }]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(stub.profile).toHaveBeenCalledOnce();
    expect((q('#memory-panel') as HTMLElement).hidden).toBe(false);
    expect([...document.querySelectorAll('.memory-row')].map((r) => r.querySelector('.memory-text')?.textContent))
      .toEqual(['prefers vim', 'uses tabs']);
  });

  it('Forget is a deliberate 2-step: the first click ARMS (no delete), the second confirms', async () => {
    const stub = setup([{ id: 'a', text: 'prefers vim' }]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    const btn = q('.memory-row .memory-forget');
    click(btn); // arm only
    expect(stub.forget).not.toHaveBeenCalled();
    expect(btn?.textContent).toMatch(/sure/i);
    click(btn); // confirm
    await flush();
    expect(stub.forget).toHaveBeenCalledWith('a');
    expect(q('.memory-row')).toBeNull(); // row removed on success
  });

  it('fails loud when forget() rejects — re-enables the button + keeps the row (not a silent dead button)', async () => {
    const stub = setup([{ id: 'a', text: 'prefers vim' }]);
    stub.forget.mockRejectedValueOnce(new Error('disk full'));
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    const btn = q('.memory-row .memory-forget') as HTMLButtonElement;
    click(btn); // arm
    click(btn); // confirm → rejects
    await flush();
    expect(q('.memory-row')).toBeTruthy(); // row survives a failed delete
    expect(btn.disabled).toBe(false); // re-enabled for retry
    expect(btn.textContent).toMatch(/fail|retry/i);
  });

  it('shows an empty state when Roro knows nothing', async () => {
    setup([]);
    mountForgetPanel();
    click(q('#memory-toggle'));
    await flush();
    expect(q('.memory-empty')?.textContent).toMatch(/doesn.t know|nothing/i);
  });

  it('unmount removes the toggle + panel', () => {
    setup();
    const unmount = mountForgetPanel();
    unmount();
    expect(q('#memory-toggle')).toBeNull();
    expect(q('#memory-panel')).toBeNull();
  });
});
