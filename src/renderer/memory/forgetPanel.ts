// src/renderer/memory/forgetPanel.ts — the Memory trust panel (Phase 2).
//
// See the facts Roro remembers, fix a wrong value, corroborate a true one, inspect safe local source
// metadata, or forget a fact. The renderer supplies only row ids and replacement text; MAIN resolves
// owner/key from the active profile. Fact and source text use textContent ONLY because they are user-authored.

import type { ProfileFactSourceView, ProfileFactView } from '../../shared/memory';
import type { MemoryHealthStatusMsg } from '../../shared/ipc';

export interface MemoryBridge {
  profile(): Promise<ProfileFactView[]>;
  fixFact(id: string, value: string): Promise<ProfileFactView>;
  verifyFact(id: string): Promise<ProfileFactView>;
  factSource(id: string): Promise<ProfileFactSourceView>;
  forget(id: string): Promise<void>;
}

export interface CompanionBridge {
  getMemoryHealthStatus?(): Promise<MemoryHealthStatusMsg | null>;
}

export interface MemoryPanelDeps {
  memory?: MemoryBridge;
  companion?: CompanionBridge;
}

function windowMemoryBridge(): MemoryBridge {
  const memory = (window as unknown as { memory?: MemoryBridge }).memory;
  if (!memory) throw new Error('window.memory is unavailable');
  return memory;
}

function windowCompanionBridge(): CompanionBridge | undefined {
  return (window as unknown as { companion?: CompanionBridge }).companion;
}

function button(className: string, label: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

function sourceSummary(source: ProfileFactSourceView['source']): string {
  if (!source) return "Source details aren't available for this memory yet.";
  const date = new Date(source.turn_ts);
  if (Number.isNaN(date.getTime())) return 'Saved from a local Roro turn.';
  return `Saved from a local Roro turn on ${date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}.`;
}

function memoryUnavailableCopy(status: MemoryHealthStatusMsg | null): string {
  if (status?.state !== 'degraded') {
    return "Roro couldn't open his memory. Close this panel and try again.";
  }
  if (status.reason === 'keychain-unavailable' || status.reason === 'memory-locked') {
    return 'Local memory is paused. Roro can still code, but memories will not load or save until macOS Keychain is available and Roro is relaunched.';
  }
  return 'Local memory is paused. Roro can still code, but memories will not load or save until memory is available again.';
}

function focusIfConnected(el: HTMLElement | null): void {
  if (el?.isConnected) el.focus();
}

function domSafeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function mountForgetPanel(
  host: HTMLElement = document.getElementById('app') ?? document.body,
  deps: MemoryPanelDeps = {},
): () => void {
  const bridge = (): MemoryBridge => deps.memory ?? windowMemoryBridge();
  const companionBridge = (): CompanionBridge | undefined => deps.companion ?? windowCompanionBridge();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'memory-toggle';
  toggle.textContent = 'What Roro remembers';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'memory-panel');

  const panel = document.createElement('div');
  panel.id = 'memory-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', 'memory-heading');

  const heading = document.createElement('h2');
  heading.id = 'memory-heading';
  heading.textContent = "Roro's memory";

  const intro = document.createElement('p');
  intro.className = 'memory-intro';
  intro.textContent = 'Local to this Mac. Check what is right, fix what is wrong, or forget it.';

  const list = document.createElement('ul');
  list.id = 'memory-list';
  panel.append(heading, intro, list);
  host.append(toggle, panel);

  function singleState(className: string, message: string): void {
    list.replaceChildren();
    const li = document.createElement('li');
    li.className = className;
    li.textContent = message;
    list.append(li);
  }

  function loadingState(): void {
    singleState('memory-empty', "Checking Roro's memory...");
  }

  function emptyState(): void {
    singleState('memory-empty', "Roro hasn't saved any facts about you yet.");
  }

  function errorState(status: MemoryHealthStatusMsg | null = null): void {
    // textContent, never innerHTML (XSS invariant). Recovery is real: reopening re-runs refresh().
    singleState('memory-error', memoryUnavailableCopy(status));
  }

  function renderSourceDetail(view: ProfileFactSourceView, id: string): HTMLElement {
    const detail = document.createElement('div');
    detail.className = 'memory-source-detail';
    detail.id = id;

    const summary = document.createElement('p');
    summary.textContent = sourceSummary(view.source);
    detail.append(summary);

    if (view.source?.session_id) {
      const session = document.createElement('p');
      session.className = 'memory-source-session';
      session.textContent = `Session: ${view.source.session_id}`;
      detail.append(session);
    }

    const privacy = document.createElement('p');
    privacy.className = 'memory-source-privacy';
    privacy.textContent = 'No transcript is shown here.';
    detail.append(privacy);
    return detail;
  }

  function renderRow(initialFact: ProfileFactView): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'memory-row';
    row.dataset.id = initialFact.id;
    const rowDomId = domSafeId(initialFact.id);
    const memoryTextId = `memory-text-${rowDomId}`;
    const sourceDetailId = `memory-source-${rowDomId}`;
    let fact = initialFact;
    let sourceView: ProfileFactSourceView | null = null;
    let sourceVisible = false;

    function focusRowAction(selector: string): void {
      queueMicrotask(() => focusIfConnected(row.querySelector<HTMLElement>(selector)));
    }

    function focusAfterRowRemoval(nextRow: Element | null, previousRow: Element | null): void {
      queueMicrotask(() => {
        const target =
          nextRow?.querySelector<HTMLElement>('.memory-verify, .memory-fix, .memory-source, .memory-forget') ??
          previousRow?.querySelector<HTMLElement>('.memory-verify, .memory-fix, .memory-source, .memory-forget') ??
          toggle;
        focusIfConnected(target);
      });
    }

    function status(message: string, className = 'memory-row-note'): HTMLElement {
      const note = document.createElement('p');
      note.className = className;
      note.textContent = message;
      return note;
    }

    function replaceWithDefault(note?: string): void {
      row.dataset.id = fact.id;
      row.replaceChildren();

      const text = document.createElement('span');
      text.id = memoryTextId;
      text.className = 'memory-text';
      text.textContent = fact.text; // textContent, NOT innerHTML: fact text is user-authored

      const actions = document.createElement('div');
      actions.className = 'memory-actions';

      const verify = button('memory-verify', 'Looks right');
      verify.setAttribute('aria-label', 'Confirm this memory is still true.');
      verify.setAttribute('aria-describedby', memoryTextId);
      const fix = button('memory-fix', 'Fix');
      fix.setAttribute('aria-describedby', memoryTextId);
      const source = button('memory-source', sourceVisible ? 'Hide source' : 'Source');
      source.setAttribute('aria-expanded', String(sourceVisible));
      source.setAttribute('aria-controls', sourceDetailId);
      source.setAttribute('aria-describedby', sourceVisible ? `${memoryTextId} ${sourceDetailId}` : memoryTextId);
      source.setAttribute('aria-label', sourceVisible ? 'Hide source details for this memory.' : 'Show source details for this memory.');
      const forget = button('memory-forget', 'Forget');
      forget.setAttribute('aria-describedby', memoryTextId);
      actions.append(verify, fix, source, forget);

      row.append(text, actions);
      if (note) row.append(status(note));
      if (sourceVisible && sourceView) {
        row.append(renderSourceDetail(sourceView, sourceDetailId));
      }

      verify.addEventListener('click', () => {
        verify.disabled = true;
        verify.textContent = 'Checking...';
        void (async () => {
          try {
            fact = await bridge().verifyFact(fact.id);
            sourceView = null;
            sourceVisible = false;
            replaceWithDefault('Checked just now.');
          } catch (e) {
            verify.disabled = false;
            verify.textContent = 'Looks right';
            const prior = row.querySelector('.memory-row-note');
            prior?.remove();
            row.append(status("Couldn't check it. Retry.", 'memory-row-note memory-row-error'));
            console.error('[memoryPanel] verify failed:', e);
          }
        })();
      });

      fix.addEventListener('click', () => {
        sourceVisible = false;
        replaceWithEdit();
      });

      source.addEventListener('click', () => {
        if (sourceVisible) {
          sourceVisible = false;
          replaceWithDefault(note);
          focusRowAction('.memory-source');
          return;
        }
        source.disabled = true;
        source.textContent = 'Checking...';
        void (async () => {
          try {
            sourceView = await bridge().factSource(fact.id);
            sourceVisible = true;
            replaceWithDefault(note);
            focusRowAction('.memory-source');
          } catch (e) {
            source.disabled = false;
            source.textContent = 'Source';
            const prior = row.querySelector('.memory-row-note');
            prior?.remove();
            row.append(status("Couldn't load the source. Retry.", 'memory-row-note memory-row-error'));
            console.error('[memoryPanel] source failed:', e);
          }
        })();
      });
      source.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !sourceVisible) return;
        event.preventDefault();
        event.stopPropagation();
        sourceVisible = false;
        replaceWithDefault(note);
        focusRowAction('.memory-source');
      });

      let armed = false;
      forget.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          forget.textContent = 'Forget forever?';
          forget.classList.add('armed');
          return;
        }
        forget.disabled = true;
        forget.textContent = 'Forgetting...';
        void (async () => {
          try {
            await bridge().forget(fact.id);
            const nextRow = row.nextElementSibling;
            const previousRow = row.previousElementSibling;
            row.remove();
            if (!list.querySelector('.memory-row')) emptyState();
            focusAfterRowRemoval(nextRow, previousRow);
          } catch (e) {
            forget.disabled = false;
            forget.textContent = "Couldn't forget. Retry.";
            console.error('[memoryPanel] forget failed:', e);
          }
        })();
      });
    }

    function replaceWithEdit(): void {
      row.replaceChildren();

      const label = document.createElement('label');
      label.className = 'memory-edit-label';
      label.textContent = 'What should Roro remember instead?';

      const input = document.createElement('input');
      input.className = 'memory-edit-input';
      input.type = 'text';
      input.value = fact.value || fact.text;
      label.append(input);

      const helper = document.createElement('p');
      helper.className = 'memory-row-note';
      helper.textContent = 'Write one short fact.';

      const actions = document.createElement('div');
      actions.className = 'memory-actions';
      const save = button('memory-save', 'Save');
      const cancel = button('memory-cancel', 'Cancel');
      actions.append(save, cancel);
      row.append(label, helper, actions);

      const original = (fact.value || fact.text).trim();
      const syncSave = (): void => {
        const next = input.value.trim();
        save.disabled = next.length === 0 || next === original;
      };
      syncSave();
      input.addEventListener('input', syncSave);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          replaceWithDefault();
          focusRowAction('.memory-fix');
        }
      });
      cancel.addEventListener('click', () => {
        replaceWithDefault();
        focusRowAction('.memory-fix');
      });
      save.addEventListener('click', () => {
        save.disabled = true;
        cancel.disabled = true;
        save.textContent = 'Saving...';
        void (async () => {
          try {
            fact = await bridge().fixFact(fact.id, input.value);
            sourceView = null;
            sourceVisible = false;
            replaceWithDefault('Saved.');
            focusRowAction('.memory-fix');
          } catch (e) {
            save.disabled = false;
            cancel.disabled = false;
            save.textContent = 'Save';
            helper.className = 'memory-row-note memory-row-error';
            helper.textContent = "Couldn't save. Old memory is unchanged. Retry.";
            syncSave();
            console.error('[memoryPanel] fix failed:', e);
          }
        })();
      });
      input.focus();
      input.select();
    }

    replaceWithDefault();
    return row;
  }

  async function refresh(): Promise<void> {
    loadingState();
    try {
      const facts = await bridge().profile();
      if (facts.length === 0) { emptyState(); return; }
      list.replaceChildren(...facts.map(renderRow));
    } catch (e) {
      // Fail loud (console) but surface a friendly, recoverable state, never a silent blank panel.
      let health: MemoryHealthStatusMsg | null = null;
      try {
        health = await companionBridge()?.getMemoryHealthStatus?.() ?? null;
      } catch {
        health = null;
      }
      errorState(health);
      console.error('[memoryPanel] profile() failed:', e);
    }
  }

  function setPanelOpen(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) void refresh(); // refetch each time it's opened so it reflects the latest memory
    else focusIfConnected(toggle);
  }

  toggle.addEventListener('click', () => {
    setPanelOpen(panel.hidden);
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    setPanelOpen(false);
  });

  return () => { toggle.remove(); panel.remove(); };
}
