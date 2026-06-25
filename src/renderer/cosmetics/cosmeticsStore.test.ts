// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountCosmeticsStore } from './cosmeticsStore';

// M9: the WS5 fake-door. A flag-gated cosmetics surface that lists the paid cosmetics (alternate pets +
// paid voice packs) and captures purchase INTENT — then STOPS (an honest "coming soon", no payment code at
// all). It measures willingness-to-pay BEFORE any store is built. Intent is a pluggable callback the founder
// wires to their aggregation; nothing here ever charges.

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const q = (s: string): HTMLElement | null => document.querySelector(s);
const click = (el: Element | null): void => (el as HTMLElement)?.click();

describe('mountCosmeticsStore — the WS5 willingness-to-pay fake-door', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it('renders a closed toggle; the panel is hidden until opened', () => {
    mountCosmeticsStore({ onIntent: vi.fn() });
    expect(q('#cosmetics-toggle')).toBeTruthy();
    expect((q('#cosmetics-panel') as HTMLElement).hidden).toBe(true);
  });

  it('lists every PAID cosmetic — the alternate pets + the paid voice packs (never the free defaults)', () => {
    mountCosmeticsStore({ onIntent: vi.fn() });
    click(q('#cosmetics-toggle'));
    const items = [...document.querySelectorAll<HTMLElement>('.cosmetic-item')].map((r) => r.dataset.id);
    // alternate pets (miro/sero/taro — roro is the free flagship) + the 4 paid voice packs
    expect(items).toContain('pet:miro');
    expect(items).toContain('pet:sero');
    expect(items).toContain('voice:bm_george');
    expect(items).not.toContain('pet:roro'); // the free default is not a paid cosmetic
    expect(items).not.toContain('voice:af_heart'); // the free default voice
  });

  it('clicking Unlock captures INTENT and STOPS at "coming soon" — there is no charge', async () => {
    const onIntent = vi.fn();
    mountCosmeticsStore({ onIntent });
    click(q('#cosmetics-toggle'));
    const row = q('.cosmetic-item[data-id="pet:miro"]');
    click(row?.querySelector('.cosmetic-unlock') ?? null);
    await flush();
    expect(onIntent).toHaveBeenCalledWith({ kind: 'pet', id: 'miro' });
    // the fake-door stops at intent: the CTA acknowledges + disables, it never reports a purchase
    expect(row?.querySelector('.cosmetic-unlock')?.textContent).toMatch(/coming soon|on the list/i);
    expect((row?.querySelector('.cosmetic-unlock') as HTMLButtonElement).disabled).toBe(true);
  });

  it('records intent only once per item (a second click does not re-fire)', async () => {
    const onIntent = vi.fn();
    mountCosmeticsStore({ onIntent });
    click(q('#cosmetics-toggle'));
    const btn = q('.cosmetic-item[data-id="voice:bm_george"] .cosmetic-unlock');
    click(btn);
    click(btn);
    await flush();
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it('a throwing onIntent leaves the item RETRYABLE (not silently captured) — the founder-aggregation footgun', async () => {
    const onIntent = vi.fn().mockImplementationOnce(() => { throw new Error('aggregation down'); });
    mountCosmeticsStore({ onIntent });
    click(q('#cosmetics-toggle'));
    const btn = q('.cosmetic-item[data-id="pet:miro"] .cosmetic-unlock') as HTMLButtonElement;
    click(btn); // onIntent throws
    await flush();
    expect(btn.disabled).toBe(false); // still clickable
    expect(btn.textContent).toBe('Unlock'); // not falsely acknowledged
    click(btn); // retry — onIntent now succeeds
    await flush();
    expect(onIntent).toHaveBeenCalledTimes(2);
    expect(btn.disabled).toBe(true); // captured on success
  });

  it('unmount removes the toggle + panel', () => {
    const unmount = mountCosmeticsStore({ onIntent: vi.fn() });
    unmount();
    expect(q('#cosmetics-toggle')).toBeNull();
    expect(q('#cosmetics-panel')).toBeNull();
  });
});
