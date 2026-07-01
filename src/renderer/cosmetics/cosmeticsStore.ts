// src/renderer/cosmetics/cosmeticsStore.ts — the WS5 willingness-to-pay FAKE-DOOR (M9).
//
// Cosmetics are how Roro monetizes the bond: buy-once, on-device assets (alternate pets, voice packs) — never
// metered cloud. Before building any store/payments, WS5 VALIDATES demand: this surface lists the paid
// cosmetics and captures purchase INTENT, then STOPS — an honest "coming soon", with NO payment code anywhere
// (the "stop at intent" is structural, not a TODO). onIntent is a pluggable callback the founder wires to
// their aggregation; real prices + whether to ship this are deliberately the founder's call (flag-gated off by
// default in bootstrap). Catalog data is rendered with textContent only (never innerHTML).

import { PET_VARIANTS } from '../../shared/pets';
import { VOICE_PACKS } from '../../shared/voicePacks';
import { resolveSoul } from '../character/souls';

export interface CosmeticIntent {
  kind: 'pet' | 'voice';
  id: string;
}

export interface CosmeticsStoreOpts {
  /** Called once when a user clicks Unlock — the willingness-to-pay signal. Wire to aggregation; never charges. */
  onIntent: (item: CosmeticIntent) => void;
  host?: HTMLElement;
}

interface CatalogItem {
  domId: string;
  name: string;
  intent: CosmeticIntent;
}

/** The PAID cosmetics: the alternate pets (roro is the free flagship) + the paid voice packs.
 *  Only souls that can actually be SHOWN are listed: `souls.ts` reframes Miro as a dog whose distinct
 *  renderer is pending art (`hasRenderer === false`), so selling it as a cat recolor would be a mislabel.
 *  It re-appears here automatically once its renderer lands. */
function paidCosmetics(): CatalogItem[] {
  const pets = PET_VARIANTS
    .filter((p) => !p.isDefault)
    .filter((p) => resolveSoul(p.id).hasRenderer)
    .map((p) => ({
      domId: `pet:${p.id}`, name: p.name, intent: { kind: 'pet' as const, id: p.id },
    }));
  const voices = VOICE_PACKS.filter((v) => v.tier === 'paid').map((v) => ({
    domId: `voice:${v.id}`, name: `${v.name} voice`, intent: { kind: 'voice' as const, id: v.id },
  }));
  return [...pets, ...voices];
}

export function mountCosmeticsStore(opts: CosmeticsStoreOpts): () => void {
  const host = opts.host ?? document.getElementById('app') ?? document.body;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'cosmetics-toggle';
  toggle.textContent = '✨ Unlock cosmetics';

  const panel = document.createElement('div');
  panel.id = 'cosmetics-panel';
  panel.hidden = true;

  const intro = document.createElement('p');
  intro.className = 'cosmetics-intro';
  intro.textContent = "Premium pets + voices — buy-once, run on-device. Tell us which you'd unlock:";
  panel.append(intro);

  const list = document.createElement('ul');
  list.id = 'cosmetics-list';

  function renderItem(item: CatalogItem): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'cosmetic-item';
    li.dataset.id = item.domId;
    const name = document.createElement('span');
    name.className = 'cosmetic-name';
    name.textContent = item.name; // textContent — catalog data, never markup
    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.className = 'cosmetic-unlock';
    unlock.textContent = 'Unlock';

    let captured = false;
    unlock.addEventListener('click', () => {
      if (captured) return; // record once per item
      // STOP AT INTENT: record the click + acknowledge. There is NO payment path — this is a fake-door.
      // onIntent is founder-pluggable (it may be wired to aggregation), so guard it: only mark captured +
      // acknowledge on SUCCESS, leaving the button retryable (fail-loud) if onIntent throws.
      try {
        opts.onIntent(item.intent);
      } catch (e) {
        console.error('[cosmetics] intent capture failed — leaving it retryable:', e);
        return;
      }
      captured = true;
      unlock.textContent = "Coming soon — you're on the list";
      unlock.classList.add('captured');
      unlock.disabled = true;
    });
    li.append(name, unlock);
    return li;
  }

  list.append(...paidCosmetics().map(renderItem));
  panel.append(list);
  host.append(toggle, panel);

  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; });

  return () => { toggle.remove(); panel.remove(); };
}
