// src/main/memoryContext.ts — compose recall into a LABELED memory string for DecideInput.memory.
// Facts (the durable "knows-you" segment) come first so truncation never drops them before episodes.
import type { MemoryRow, MemoryMatch } from '../shared/memory';

export interface RecallDeps {
  getProfile(ownerId: string): Promise<MemoryRow[]>;
  recall(input: { query: string; k?: number; ownerId: string; sessionId?: string }): Promise<MemoryMatch[]>;
}

export function composeMemoryContext(facts: MemoryRow[], episodes: MemoryMatch[]): string | undefined {
  const sections: string[] = [];
  if (facts.length > 0) {
    sections.push(['KNOWN ABOUT THIS USER:', ...facts.map((f) => `- ${f.text}`)].join('\n'));
  }
  if (episodes.length > 0) {
    sections.push(['RELATED PAST CONTEXT:', ...episodes.map((e) => `- ${e.text}`)].join('\n'));
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export async function buildRecallContext(
  deps: RecallDeps,
  opts: { ownerId: string; sessionId: string; query: string; k?: number; minSimilarity?: number },
): Promise<{ context: string | undefined; factCount: number; episodeCount: number }> {
  const minSimilarity = opts.minSimilarity ?? 0.3;
  // Facts (the durable "knows-you" moat — a plain SQL filter) and episodes (vector recall, which
  // embeds the query and can fail) must degrade INDEPENDENTLY: an embedding/recall failure must
  // never drop the facts from the decide prompt, and vice-versa. allSettled, not all.
  const [factsResult, matchesResult] = await Promise.allSettled([
    deps.getProfile(opts.ownerId),
    deps.recall({ query: opts.query, k: opts.k, ownerId: opts.ownerId, sessionId: opts.sessionId }),
  ]);
  if (factsResult.status === 'rejected') {
    console.error('[memory] getProfile failed:', (factsResult.reason as Error)?.message ?? factsResult.reason);
  }
  if (matchesResult.status === 'rejected') {
    console.error('[memory] recall failed:', (matchesResult.reason as Error)?.message ?? matchesResult.reason);
  }
  const facts = factsResult.status === 'fulfilled' ? factsResult.value : [];
  const matches = matchesResult.status === 'fulfilled' ? matchesResult.value : [];
  const episodes = matches.filter((m) => m.similarity > minSimilarity);
  return {
    context: composeMemoryContext(facts, episodes),
    factCount: facts.length,
    episodeCount: episodes.length,
  };
}
