// LIVE end-to-end smoke of the recalled-memory magic moment against the REAL local brain
// (qwen2.5:3b decide/extract + nomic-embed-text 768-dim embeddings). Gated on OLLAMA_AVAILABLE=1 so the
// default CI suite (no daemon) skips it; run locally with: OLLAMA_AVAILABLE=1 npx vitest run crosslaunch.live
//
// Unlike crosslaunch.durability.test.ts (fake 16-dim embedder — proves files-as-truth deterministically),
// this exercises the ACTUAL model: a real decision, a real extracted fact, real semantic recall across a
// real restart, and finally the payoff — feeding the recalled memory back into a real decide().
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as brain from '../brain/index';
import { createMemoryFacade } from './index';
import { createMemoryStore } from './memoryStore';
import { createAesGcmCipher } from './cipher';
import { buildRecallContext } from '../orchestrator/memoryContext';

const realEmbed = async (t: string): Promise<number[]> => (await brain.embed(t)) as number[];

describe.runIf(process.env.OLLAMA_AVAILABLE === '1')('LIVE magic moment (real qwen2.5:3b + nomic-embed-text)', () => {
  it('decides, extracts a fact, and recalls it across a restart — fully end to end', async () => {
    // 1) DECIDE — a real coding request through the local 3B brain
    const decision = await brain.decide({ transcript: 'add a logout route to the api' });
    console.log('\n[1 DECIDE] command=%s\n          narration=%j', decision.command, decision.narration);
    expect(['run_agent', 'answer', 'clarify', 'capture_screen']).toContain(decision.command);

    // 2) EXTRACT — a NOUN-like preference the 3B extracts reliably (a behavioral habit like "writes a test
    // alongside each feature" boolean-collapses to "true" → the guard nulls it → this demo would flake; that
    // weakness is measured separately in the eval's BEHAVIORAL set, not asserted in this magic-moment demo).
    const fact = await brain.extractFact({
      transcript: 'we always use pnpm in this repo, never npm',
      narration: 'Got it, pnpm it is.',
      outcome: 'answered',
    });
    console.log('[2 EXTRACT] fact=%j', fact);
    if (!fact) throw new Error('extractFact returned null for a clearly-stated noun preference (pnpm)');

    // 3) MAGIC MOMENT — store in launch A, reopen launch B from disk, recall via REAL 768-dim embeddings
    const dir = mkdtempSync(join(tmpdir(), 'mem2live-'));
    const cipher = createAesGcmCipher(Buffer.alloc(32, 7));
    const dim = (await brain.embed('dimension probe')).length;
    console.log('[3 EMBED] real embedding dim=%d', dim);
    try {
      const a = createMemoryFacade(await createMemoryStore({ dir, embed: realEmbed, dim, cipher }));
      await a.replaceFact({ ownerId: 'me', sessionId: 'A', factKey: fact.key, text: fact.value, payload: { key: fact.key, value: fact.value } });
      await a.remember({ ownerId: 'me', sessionId: 'A', kind: 'observation', text: 'added a logout route' });
      await a.close();

      const b = createMemoryFacade(await createMemoryStore({ dir, embed: realEmbed, dim, cipher }));
      try {
        const ctx = await buildRecallContext(b, { ownerId: 'me', sessionId: 'B', query: 'add a signup route too', minSimilarity: 0 });
        console.log('\n[4 RECALL across restart] factCount=%d episodeCount=%d\n--- memory fed to the brain ---\n%s\n-------------------------------', ctx.factCount, ctx.episodeCount, ctx.context);
        expect(ctx.factCount).toBe(1);
        expect(ctx.context).toContain(fact.value);

        // 5) THE PAYOFF — the brain, handed the recalled memory, decides on a NEW but related request
        const aware = await brain.decide({ transcript: 'add a signup route', memory: ctx.context });
        console.log('[5 DECIDE w/ recalled memory] command=%s\n                             narration=%j\n', aware.command, aware.narration);
        expect(['run_agent', 'answer', 'clarify', 'capture_screen']).toContain(aware.command);
      } finally {
        await b.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
