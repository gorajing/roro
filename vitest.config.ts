// eslint-disable-next-line import/no-unresolved -- 'vitest/config' is a real subpath export the import resolver can't follow
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Run test FILES serially. The memory2 suites each spin a real WASM PGlite (Postgres) in beforeEach;
    // under parallel worker contention those hooks thrash CPU and time out non-deterministically, so the
    // default `vitest run` flaked ~2-of-3. Serializing removes the contention (reliably green). The raised
    // test/hook timeouts are defense-in-depth for a genuinely-slow PGlite spin-up (the cost is in the HOOK).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      // phonemize (the MIT G2P) ships attribute-less JSON imports that Node's strict ESM loader rejects
      // when vitest externalizes node_modules. Inline it so Vite's json plugin handles it — the same way
      // the renderer's Vite BUILD already does (rollup's json plugin). Targeted to this one dep.
      deps: { inline: ['phonemize'] },
    },
  },
});
