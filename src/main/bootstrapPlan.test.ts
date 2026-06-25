import { describe, it, expect } from 'vitest';
import { bootstrapPlan, describeBootstrap, formatBytes, bootstrapFailureMessage, DEFAULT_MODEL_SPECS } from './bootstrapPlan';

// First-run bootstrap (M7): given whether the local Ollama daemon is reachable + which models it already has,
// compute what must be pulled and the HONEST download size — splitting the ESSENTIAL core-loop models
// (reason + embed, ~2GB) from the heavy OPTIONAL vision model (~6GB), so first-run doesn't demand 8GB up front
// (the roadmap's "biggest install-conversion lever"). Pure: the IO (ollamaTags) is resolved by the caller.

const names = (specs: { name: string }[]): string[] => specs.map((s) => s.name);

describe('bootstrapPlan', () => {
  it('when Ollama is unreachable: not ready, and nothing can be pulled yet (Ollama itself comes first)', () => {
    const p = bootstrapPlan({ ollamaReachable: false, installedModels: [] }, DEFAULT_MODEL_SPECS);
    expect(p.ollamaReachable).toBe(false);
    expect(p.ready).toBe(false);
    expect(p.needsOllamaInstall).toBe(true);
  });

  it('reachable, no models: essential = reason+embed, optional = vision, not ready', () => {
    const p = bootstrapPlan({ ollamaReachable: true, installedModels: [] }, DEFAULT_MODEL_SPECS);
    expect(p.needsOllamaInstall).toBe(false);
    expect(names(p.missingEssential).sort()).toEqual(['nomic-embed-text', 'qwen2.5:3b']);
    expect(names(p.missingOptional)).toEqual(['qwen2.5vl:7b']);
    expect(p.ready).toBe(false);
  });

  it('discloses the ESSENTIAL download size only (not the 8GB total) — the conversion lever', () => {
    const p = bootstrapPlan({ ollamaReachable: true, installedModels: [] }, DEFAULT_MODEL_SPECS);
    const essentialTotal = DEFAULT_MODEL_SPECS.filter((m) => m.essential).reduce((s, m) => s + m.bytes, 0);
    expect(p.essentialBytes).toBe(essentialTotal);
    expect(p.essentialBytes).toBeLessThan(3e9); // core loop is ~2GB, NOT the ~8GB full set
  });

  it('READY once the essential models are present, even though optional vision is still missing', () => {
    const p = bootstrapPlan(
      { ollamaReachable: true, installedModels: ['qwen2.5:3b', 'nomic-embed-text'] },
      DEFAULT_MODEL_SPECS,
    );
    expect(p.ready).toBe(true);
    expect(p.missingEssential).toEqual([]);
    expect(names(p.missingOptional)).toEqual(['qwen2.5vl:7b']); // still offered, but doesn't block readiness
    expect(p.essentialBytes).toBe(0);
  });

  it('matches an untagged model name against its :latest tag (nomic-embed-text ⇔ nomic-embed-text:latest)', () => {
    const p = bootstrapPlan(
      { ollamaReachable: true, installedModels: ['qwen2.5:3b', 'nomic-embed-text:latest', 'qwen2.5vl:7b'] },
      DEFAULT_MODEL_SPECS,
    );
    expect(p.ready).toBe(true);
    expect(p.missingEssential).toEqual([]);
    expect(p.missingOptional).toEqual([]); // everything present
  });

  it('a same-family but different-tag model does NOT count as installed (qwen2.5:7b ≠ qwen2.5:3b)', () => {
    const p = bootstrapPlan({ ollamaReachable: true, installedModels: ['qwen2.5:7b'] }, DEFAULT_MODEL_SPECS);
    expect(names(p.missingEssential)).toContain('qwen2.5:3b'); // the 7b tag is not the required 3b
  });
});

describe('formatBytes', () => {
  it('renders GB for large and MB for small, one decimal for GB', () => {
    expect(formatBytes(1_900_000_000)).toBe('1.9 GB');
    expect(formatBytes(274_000_000)).toBe('274 MB');
  });
});

describe('describeBootstrap — the honest first-run disclosure', () => {
  it('guides installing Ollama first when the daemon is unreachable', () => {
    const msg = describeBootstrap(bootstrapPlan({ ollamaReachable: false, installedModels: [] }));
    expect(msg).toMatch(/ollama/i);
    expect(msg).toMatch(/install/i);
  });

  it('lists the missing ESSENTIAL models + the honest size — and NOT the heavy optional vision model', () => {
    const msg = describeBootstrap(bootstrapPlan({ ollamaReachable: true, installedModels: [] }));
    expect(msg).toMatch(/qwen2\.5:3b/);
    expect(msg).toMatch(/nomic-embed-text/);
    expect(msg).toMatch(/GB/); // the size is disclosed
    expect(msg).not.toMatch(/qwen2\.5vl:7b/); // optional vision is NOT in the first-run essential ask
  });

  it('is empty when ready (no disclosure to make)', () => {
    const msg = describeBootstrap(bootstrapPlan({ ollamaReachable: true, installedModels: ['qwen2.5:3b', 'nomic-embed-text'] }));
    expect(msg).toBe('');
  });
});

describe('bootstrapFailureMessage — choose the startup-failure caption', () => {
  const base = 'Local brain unavailable: Ollama timed out at http://127.0.0.1:11434 — restart it: ollama serve';

  it('a nebius failure keeps the accurate base message (a cloud-key issue, not bootstrap)', () => {
    expect(bootstrapFailureMessage(base, 'nebius', { kind: 'reachable', models: [] })).toBe(base);
  });

  it('a DEGRADED (timed-out, wedged-but-RUNNING) daemon keeps the base message — never says "install Ollama"', () => {
    const msg = bootstrapFailureMessage(base, 'ollama', { kind: 'degraded' });
    expect(msg).toBe(base); // the regression: a wedged daemon must NOT be told to reinstall
    expect(msg).not.toMatch(/install/i);
  });

  it('an UNREACHABLE daemon (not running) gets the install-Ollama guidance', () => {
    expect(bootstrapFailureMessage(base, 'ollama', { kind: 'unreachable' })).toMatch(/install/i);
  });

  it('reachable but missing essentials → the pull guidance', () => {
    expect(bootstrapFailureMessage(base, 'ollama', { kind: 'reachable', models: [] })).toMatch(/qwen2\.5:3b/);
  });

  it('reachable with essentials present (preflight failed for another reason) → falls back to base', () => {
    expect(bootstrapFailureMessage(base, 'ollama', { kind: 'reachable', models: ['qwen2.5:3b', 'nomic-embed-text'] })).toBe(base);
  });
});
