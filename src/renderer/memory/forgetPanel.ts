// src/renderer/memory/forgetPanel.ts — the transparency + Forget panel (M8b).
//
// See the facts Roro knows about you, and forget any of them. A thin DOM shell over window.memory.profile()
// / .forget(id) (both owner-scoped MAIN-side). Forget is a DELIBERATE 2-step (Forget → confirm) because the
// delete is irreversible (a hard tombstone, not a hide). Fact text is rendered with textContent ONLY — never
// innerHTML — since it's whatever the user said and must never be interpreted as markup (XSS). Not unit-tested
// beyond the jsdom behavioral test (no real layout in CI).

interface MemoryBridge {
  profile(): Promise<Array<{ id: string; text: string }>>;
  forget(id: string): Promise<void>;
}

function bridge(): MemoryBridge | undefined {
  return (window as unknown as { memory?: MemoryBridge }).memory;
}

export function mountForgetPanel(host: HTMLElement = document.getElementById('app') ?? document.body): () => void {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'memory-toggle';
  toggle.textContent = '🧠 What Roro knows';

  const panel = document.createElement('div');
  panel.id = 'memory-panel';
  panel.hidden = true;
  const list = document.createElement('ul');
  list.id = 'memory-list';
  panel.append(list);
  host.append(toggle, panel);

  function emptyState(): void {
    list.replaceChildren();
    const li = document.createElement('li');
    li.className = 'memory-empty';
    li.textContent = "Roro doesn't know any facts about you yet.";
    list.append(li);
  }

  function renderRow(fact: { id: string; text: string }): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'memory-row';
    row.dataset.id = fact.id;
    const text = document.createElement('span');
    text.className = 'memory-text';
    text.textContent = fact.text; // textContent, NOT innerHTML — fact text is user-authored, never markup
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'memory-forget';
    forget.textContent = 'Forget';

    // Deliberate 2-step delete: first click arms a confirm, second performs the (irreversible) forget.
    let armed = false;
    forget.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        forget.textContent = 'Forget — sure?';
        forget.classList.add('armed');
        return;
      }
      forget.disabled = true; // prevent a double-confirm while the delete is in flight
      void (async () => {
        try {
          await bridge()?.forget(fact.id);
          row.remove(); // drop the row on success
          if (!list.querySelector('.memory-row')) emptyState();
        } catch (e) {
          // Fail loud, not silent: re-enable the button + say it failed so the user can retry, rather than
          // leaving a dead "sure?" button that did nothing.
          forget.disabled = false;
          forget.textContent = 'Forget — failed, retry';
          console.error('[forgetPanel] forget failed:', e);
        }
      })();
    });
    row.append(text, forget);
    return row;
  }

  async function refresh(): Promise<void> {
    const facts = (await bridge()?.profile()) ?? [];
    if (facts.length === 0) { emptyState(); return; }
    list.replaceChildren(...facts.map(renderRow));
  }

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) void refresh(); // refetch each time it's opened so it reflects the latest memory
  });

  return () => { toggle.remove(); panel.remove(); };
}
