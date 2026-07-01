// src/renderer/ambient.d.ts — LOCAL, renderer-owned ambient declarations.
//
// Purpose: keep THIS component's `tsc --noEmit` green regardless of whether
// another agent's src/types/companion.d.ts (which declares window.companion /
// window.brain / window.memory / window.vision) is present yet.
//
// We declare ONLY window.RORO_CFG (+ the deprecated COMPANION_CFG alias) here. companion.d.ts does
// NOT declare them, so there is no merge conflict. We deliberately DO NOT (re)declare
// window.companion / window.brain in this file: declaring the same Window
// property twice across merged `interface Window` blocks with structurally
// different types is a TypeScript error ("Subsequent property declarations must
// have the same type"). Instead, this component reads the companion/brain
// bridges through a narrow local cast in events/bridge.ts, which type-checks
// whether or not companion.d.ts is present.

import type { RoroConfig } from './config';

declare global {
  interface Window {
    /** Renderer-safe runtime config (non-secret feature flags + window mode). */
    RORO_CFG?: Partial<RoroConfig>;
    /** @deprecated legacy alias of RORO_CFG — still read for back-compat. */
    COMPANION_CFG?: Partial<RoroConfig>;
  }
}

export {};
