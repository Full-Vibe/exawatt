import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@exawatt/ui-model',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'threads',
    isolate: false,
  },
});
