// scripts/smoke-typed-live-turn.mjs — default full-window typed prompt live-turn smoke.
//
// The shared live-turn harness lives in smoke-floating-live-turn.mjs because it owns the
// fake Ollama/Codex servers and CDP plumbing. This wrapper selects the non-floating typed
// surface so callers get an explicit verification command for the default product window.

process.env.RORO_LIVE_SURFACE = 'typed';
await import('./smoke-floating-live-turn.mjs');
