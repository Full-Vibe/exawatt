import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep execution regimes explicit. Node-only tests avoid React transforms,
    // jest-dom setup, and one jsdom instance per isolated test file.
    projects: [
      './packages/core/vitest.config.ts',
      './packages/ui-model/vitest.config.ts',
      './vitest.config.app-node.ts',
      './vitest.config.app-dom.ts',
    ],
  },
});
