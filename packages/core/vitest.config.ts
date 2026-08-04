import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@exawatt/core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'threads',
  },
});
