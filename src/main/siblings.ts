// src/main/siblings.ts — lazy, typed access to the sibling MAIN-process modules
// (brain / memory / vision).
//
// WHY THIS SHAPE:
//   - Each sibling is imported via a LAZY dynamic import so its heavy dependencies (PGlite,
//     sharp, model clients) load on FIRST USE, not at app startup.
//   - Types are DERIVED from the real modules (`typeof import(...)`), so any drift between what
//     main calls and what a sibling actually exports is a COMPILE error, not a runtime surprise.
//     (These used to be hand-rolled structural mirrors from the multi-agent build era, when the
//     sibling modules might not exist on disk yet. They all exist in-repo now.)

type BrainExports = typeof import('../brain/index');
type MemoryExports = typeof import('../memory2/index');
type VisionExports = typeof import('../vision/index');

// The subset of each sibling's export surface that MAIN consumes. Pick<> pins these names to the
// real module (a rename/removal there fails the build here) while keeping test fakes small.
export type BrainModule = Pick<
  BrainExports,
  'decide' | 'describeScreen' | 'groundTarget' | 'embed' | 'extractFact' | 'preflight' | 'describeBrain'
>;

/** Result of the brain's startup self-check (the real brain.PreflightResult). */
export type BrainPreflightResult = Awaited<ReturnType<BrainExports['preflight']>>;

export type MemoryModule = Pick<
  MemoryExports,
  | 'remember'
  | 'replaceFact'
  | 'reinforceFact'
  | 'recall'
  | 'getProfile'
  | 'profileFacts'
  | 'fixFact'
  | 'verifyFact'
  | 'factSource'
  | 'supersede'
  | 'forgetFact'
  | 'traceExtraction'
>;

export type VisionModule = Pick<VisionExports, 'captureScreen' | 'askScreen'>;

// ---- Lazy loaders. `import()` caches the loaded module; `@vite-ignore` keeps the bundler from
// hoisting these heavy modules into the eager startup graph.

export async function loadBrain(): Promise<BrainModule> {
  return import(/* @vite-ignore */ '../brain/index');
}

export async function loadMemory(): Promise<MemoryModule> {
  return import(/* @vite-ignore */ '../memory2/index');
}

export async function loadVision(): Promise<VisionModule> {
  return import(/* @vite-ignore */ '../vision/index');
}
