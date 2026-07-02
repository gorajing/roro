// src/main/bootstrapPlan.ts — the first-run readiness plan (M7), PURE + testable.
//
// Roro is local-first: the core loop needs a local Ollama daemon + a small set of models. First-run must be
// honest about that cost WITHOUT scaring the user off with the full ~8GB. So this splits ESSENTIAL models
// (reason + embed — the decide + memory loop, ~2GB) from the heavy OPTIONAL vision model (~6GB + needs
// substantial RAM): readiness depends ONLY on the essentials; vision is offered but never blocks. The IO
// (is Ollama reachable + ollamaTags) is resolved by the caller; this just decides what's missing + the size.

import type { BootstrapStatusMsg } from '../../shared/ipc';

export interface ModelSpec {
  /** The exact ollama model id (with tag) to pull, e.g. 'qwen2.5:3b'. */
  name: string;
  role: 'reason' | 'embed' | 'vision';
  /** Approximate download size in bytes (for the honest pre-pull disclosure; ollama can't report it pre-pull). */
  bytes: number;
  /** Essential = the core loop can't run without it. Optional (vision) degrades gracefully. */
  essential: boolean;
}

// The local default model set (mirrors OLLAMA_MODELS in src/brain/index.ts). Sizes are the approximate Q4
// download sizes from the ollama registry — keep them roughly in sync when the default models change.
export const DEFAULT_MODEL_SPECS: ModelSpec[] = [
  { name: 'qwen2.5:3b', role: 'reason', bytes: 1_900_000_000, essential: true },
  { name: 'nomic-embed-text', role: 'embed', bytes: 274_000_000, essential: true },
  { name: 'qwen2.5vl:7b', role: 'vision', bytes: 6_000_000_000, essential: false },
];

export interface BootstrapStatus {
  /** Is the local Ollama daemon reachable (ollamaTags succeeded)? */
  ollamaReachable: boolean;
  /** Installed model ids from ollama /api/tags (e.g. ['qwen2.5:3b', 'nomic-embed-text:latest']). */
  installedModels: string[];
}

export interface BootstrapPlan {
  ollamaReachable: boolean;
  /** Ollama itself must be installed/started before any model can be pulled. */
  needsOllamaInstall: boolean;
  /** Essential models not yet present — the core loop can't run until these are pulled. */
  missingEssential: ModelSpec[];
  /** Optional models not yet present — offered, but readiness does NOT depend on them. */
  missingOptional: ModelSpec[];
  /** Total bytes to pull for the ESSENTIAL set only (the honest "cost to get started", not the ~8GB total). */
  essentialBytes: number;
  /** True when Ollama is reachable AND every essential model is present (the core loop can run). */
  ready: boolean;
}

/**
 * The outcome of probing the local Ollama daemon (ollamaTags). `degraded` (a TIMEOUT) means the daemon is up
 * but wedged/slow — distinct from `unreachable` (connection refused — not running): reinstalling won't fix a
 * wedged daemon, so the two earn DIFFERENT guidance.
 */
export type OllamaProbe =
  | { kind: 'reachable'; models: string[] }
  | { kind: 'unreachable' }
  | { kind: 'degraded' };

/**
 * Choose the renderer caption after a brain-preflight FAILURE. Only a local-Ollama unreachable/missing-model
 * failure earns bootstrap guidance; a DEGRADED/timeout (the daemon is up, just wedged — "install Ollama"
 * would be wrong) keeps the accurate preflight `baseMessage`. Pure + testable.
 */
export function bootstrapFailureMessage(baseMessage: string, probe: OllamaProbe): string {
  if (probe.kind === 'degraded') return baseMessage;
  const plan = bootstrapPlan(
    probe.kind === 'reachable'
      ? { ollamaReachable: true, installedModels: probe.models }
      : { ollamaReachable: false, installedModels: [] },
  );
  return describeBootstrap(plan) || baseMessage; // empty guidance (ready / non-model failure) → keep baseMessage
}

/**
 * The structured first-run status to push to the renderer (M7b), derived from an Ollama probe. Returns null
 * for a DEGRADED (wedged/timeout) daemon — a download can't fix that, so the renderer shows no action.
 */
export function bootstrapStatusFor(probe: OllamaProbe): BootstrapStatusMsg | null {
  if (probe.kind === 'degraded') return null;
  const plan = bootstrapPlan(
    probe.kind === 'reachable'
      ? { ollamaReachable: true, installedModels: probe.models }
      : { ollamaReachable: false, installedModels: [] },
  );
  return {
    ready: plan.ready,
    needsOllamaInstall: plan.needsOllamaInstall,
    missing: plan.missingEssential.map((m) => ({ name: m.name, bytes: m.bytes })),
    essentialBytes: plan.essentialBytes,
  };
}

/** Human-readable size for the pre-pull disclosure: GB (1 decimal) for large, MB (rounded) for small. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/**
 * The honest first-run disclosure derived from a plan: install Ollama if it's down, else name the missing
 * ESSENTIAL models + the size to pull. Empty when ready (nothing to say). Vision is intentionally never in
 * the first-run ask — it's offered separately so the core loop isn't gated on a 6GB download.
 */
export function describeBootstrap(plan: BootstrapPlan): string {
  if (plan.ready) return '';
  if (plan.needsOllamaInstall) {
    return `Ollama isn't running. Install it from https://ollama.com, then Roro pulls ~${formatBytes(plan.essentialBytes)} of local models to get started.`;
  }
  const cmds = plan.missingEssential.map((m) => `\`ollama pull ${m.name}\``).join(' and ');
  return `Roro needs its core models (~${formatBytes(plan.essentialBytes)}) — run ${cmds}.`;
}

/** A required model is present if its exact id is installed, or (for an untagged id) its `:latest` tag is. */
function isInstalled(spec: ModelSpec, installed: string[]): boolean {
  if (installed.includes(spec.name)) return true;
  return !spec.name.includes(':') && installed.includes(`${spec.name}:latest`);
}

export function bootstrapPlan(status: BootstrapStatus, specs: ModelSpec[] = DEFAULT_MODEL_SPECS): BootstrapPlan {
  // Can't probe/pull models without the daemon — Ollama install/start is the precondition for everything else.
  if (!status.ollamaReachable) {
    return {
      ollamaReachable: false,
      needsOllamaInstall: true,
      missingEssential: specs.filter((m) => m.essential),
      missingOptional: specs.filter((m) => !m.essential),
      essentialBytes: specs.filter((m) => m.essential).reduce((s, m) => s + m.bytes, 0),
      ready: false,
    };
  }
  const missing = specs.filter((m) => !isInstalled(m, status.installedModels));
  const missingEssential = missing.filter((m) => m.essential);
  return {
    ollamaReachable: true,
    needsOllamaInstall: false,
    missingEssential,
    missingOptional: missing.filter((m) => !m.essential),
    essentialBytes: missingEssential.reduce((s, m) => s + m.bytes, 0),
    ready: missingEssential.length === 0,
  };
}
