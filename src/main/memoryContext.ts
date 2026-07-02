// src/main/memoryContext.ts — compose recall into a LABELED memory string for DecideInput.memory.
// Facts (the durable "knows-you" segment) come first so truncation never drops them before episodes.
import type { Entry, MemoryMatch, RecallInput } from '../shared/memory';
import { MEMORY_EPISODES_HEADER, MEMORY_FACTS_HEADER } from '../shared/memoryFormat';

export interface RecallDeps {
  getProfile(ownerId: string): Promise<Entry[]>;
  recall(input: RecallInput): Promise<MemoryMatch[]>;
}

export function composeMemoryContext(facts: Entry[], episodes: MemoryMatch[]): string | undefined {
  const sections: string[] = [];
  if (facts.length > 0) {
    sections.push([MEMORY_FACTS_HEADER, ...facts.map((f) => `- ${f.text}`)].join('\n'));
  }
  if (episodes.length > 0) {
    sections.push([MEMORY_EPISODES_HEADER, ...episodes.map((e) => `- ${e.entry.text}`)].join('\n'));
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export async function buildRecallContext(
  deps: RecallDeps,
  opts: { ownerId: string; sessionId: string; query: string; k?: number; minSimilarity?: number; repoId?: string },
): Promise<{ context: string | undefined; factCount: number; episodeCount: number }> {
  const minSimilarity = opts.minSimilarity ?? 0.3;
  // Facts (the durable "knows-you" moat — a plain index filter) and episodes (vector recall, which
  // embeds the query and can fail) must degrade INDEPENDENTLY: an embedding/recall failure must
  // never drop the facts from the decide prompt, and vice-versa. allSettled, not all.
  const [factsResult, matchesResult] = await Promise.allSettled([
    deps.getProfile(opts.ownerId),
    deps.recall({ query: opts.query, k: opts.k, ownerId: opts.ownerId, sessionId: opts.sessionId, repoId: opts.repoId }),
  ]);
  if (factsResult.status === 'rejected') {
    console.error('[memory] getProfile failed:', (factsResult.reason as Error)?.message ?? factsResult.reason);
  }
  if (matchesResult.status === 'rejected') {
    console.error('[memory] recall failed:', (matchesResult.reason as Error)?.message ?? matchesResult.reason);
  }
  const facts = factsResult.status === 'fulfilled' ? factsResult.value : [];
  const matches = matchesResult.status === 'fulfilled' ? matchesResult.value : [];
  // The floor NEVER applies to recency-guaranteed rows: memory2 promises those surface regardless of
  // cosine (they carry similarity 0), and the `guaranteed` flag carries that promise through the type
  // so no floor value — present or future — can silently kill temporal recall. Inclusive `>=` for the
  // scored rows so a 0 floor keeps memory2's ranked top-k as-is.
  const episodes = matches.filter((m) => m.guaranteed || m.similarity >= minSimilarity);
  return {
    context: composeMemoryContext(facts, episodes),
    factCount: facts.length,
    episodeCount: episodes.length,
  };
}
