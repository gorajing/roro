import type { MemoryHealthStatusMsg } from '../../shared/ipc';
import type { ProfileFactSourceView, ProfileFactView } from '../../shared/memory';
import type { MemoryPanelDeps } from './forgetPanel';

const SMOKE_ID = 'memory-panel-rendered-smoke';
const CREATED_AT = '2026-06-27T00:00:00.000Z';
const SOURCE = {
  session_id: 'memory-panel-rendered-smoke-session',
  turn_ts: Date.parse(CREATED_AT),
};

function smokeFact(value = 'prefers vim'): ProfileFactView {
  return {
    id: SMOKE_ID,
    key: 'editor',
    value,
    text: value,
    created_at: CREATED_AT,
    source: SOURCE,
  };
}

export function createMemoryPanelSmokeDeps(): MemoryPanelDeps {
  let facts = [smokeFact()];

  return {
    memory: {
      profile: async () => facts,
      fixFact: async (id, value) => {
        facts = facts.map((fact) => (fact.id === id ? smokeFact(value) : fact));
        return facts.find((fact) => fact.id === id) ?? smokeFact(value);
      },
      verifyFact: async (id) => facts.find((fact) => fact.id === id) ?? smokeFact(),
      factSource: async (id): Promise<ProfileFactSourceView> => ({
        id,
        source: SOURCE,
      }),
      forget: async (id) => {
        facts = facts.filter((fact) => fact.id !== id);
      },
    },
    companion: {
      getMemoryHealthStatus: async (): Promise<MemoryHealthStatusMsg | null> => null,
    },
  };
}
