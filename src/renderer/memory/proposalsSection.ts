// src/renderer/memory/proposalsSection.ts — the "Roro noticed — save it?" review surface
// (executor-facts pilot, spec: docs/plans/executor-facts-pilot.md).
//
// Self-gating: the backing IPC handlers exist ONLY when RORO_EXECUTOR_FACTS is on; when they are
// unregistered the fetch rejects, we render nothing, and the section is inert — no cfg plumbing
// needed. Nothing here stores anything: [Save] round-trips through MAIN, which injects ownerId and
// runs the same supersede-not-overwrite fact lifecycle as every other fact. textContent ONLY (the
// panel's XSS invariant); failure is recoverable in place ("Couldn't save. Retry.").

import type { FactProposalView } from '../../shared/factProposals';

export interface ProposalsBridge {
  proposals(): Promise<FactProposalView[]>;
  resolveProposal(id: string, accept: boolean): Promise<{ ok: boolean; gone?: boolean }>;
}

function windowBridge(): ProposalsBridge | undefined {
  const memory = (window as unknown as { memory?: Partial<ProposalsBridge> }).memory;
  if (!memory?.proposals || !memory.resolveProposal) return undefined;
  return memory as ProposalsBridge;
}

/** Mount the proposals section into the memory panel host. Returns an unmount fn. */
export function mountProposalsSection(
  host: HTMLElement,
  deps: { bridge?: ProposalsBridge } = {},
): { unmount: () => void; refresh: () => Promise<void> } {
  const bridge = (): ProposalsBridge | undefined => deps.bridge ?? windowBridge();

  const section = document.createElement('div');
  section.id = 'memory-proposals';
  section.hidden = true;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-label', 'Suggested memories awaiting your OK');
  host.appendChild(section);

  const render = (rows: FactProposalView[]): void => {
    section.replaceChildren();
    section.hidden = rows.length === 0;
    if (rows.length === 0) return;

    const heading = document.createElement('h3');
    heading.textContent = 'Roro noticed — save it?';
    section.appendChild(heading);

    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'memory-proposal';

      const label = document.createElement('div');
      label.className = 'memory-proposal-text';
      label.textContent = `${row.key.replace(/_/g, ' ')}: ${row.value}`;
      item.appendChild(label);

      const meta = document.createElement('div');
      meta.className = 'memory-proposal-meta';
      // The claiming agent is NAMED (trust: the user must always know WHO claimed a fact), and the
      // evidence quote is shown — informed confirmation beats blind confirmation.
      meta.textContent = `${row.agent} noticed this during a coding run — “${row.evidence}”`;
      item.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'memory-proposal-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Not for me';
      actions.append(save, reject);
      item.appendChild(actions);

      const status = document.createElement('div');
      status.className = 'memory-proposal-status';
      item.appendChild(status);

      const resolve = async (accept: boolean): Promise<void> => {
        const b = bridge();
        if (!b) return;
        save.disabled = true;
        reject.disabled = true;
        try {
          await b.resolveProposal(row.id, accept);
          await refresh(); // the row leaves the queue (or was already gone) — re-render from truth
        } catch {
          // Fail loud but recoverable: the proposal is still queued MAIN-side; re-enable and say so.
          save.disabled = false;
          reject.disabled = false;
          status.textContent = "Couldn't save. Retry.";
        }
      };
      save.addEventListener('click', () => { void resolve(true); });
      reject.addEventListener('click', () => { void resolve(false); });

      section.appendChild(item);
    }
  };

  const refresh = async (): Promise<void> => {
    const b = bridge();
    if (!b) return render([]);
    try {
      render(await b.proposals());
    } catch {
      render([]); // handlers unregistered (flag off) or transient failure — inert, never an error UI
    }
  };

  return { unmount: () => section.remove(), refresh };
}
