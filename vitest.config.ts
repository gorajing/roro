// eslint-disable-next-line import/no-unresolved -- 'vitest/config' is a real subpath export the import resolver can't follow
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Default (parallel) file execution. The old `fileParallelism: false` existed ONLY because the
    // memory2 suites each spun a real WASM PGlite (Postgres) in beforeEach and thrashed under worker
    // contention; PGlite is gone (W5: in-memory index + vectorCache sidecar), so the serialization
    // went with it — gated on 3 consecutive full-suite green parallel runs. The raised timeouts stay
    // as defense-in-depth for slow CI machines (the fs-heavy durability suites).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
