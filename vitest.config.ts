// eslint-disable-next-line import/no-unresolved -- 'vitest/config' is a real subpath export the import resolver can't follow
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      // phonemize (the MIT G2P) ships attribute-less JSON imports that Node's strict ESM loader rejects
      // when vitest externalizes node_modules. Inline it so Vite's json plugin handles it — the same way
      // the renderer's Vite BUILD already does (rollup's json plugin). Targeted to this one dep.
      deps: { inline: ['phonemize'] },
    },
  },
});
