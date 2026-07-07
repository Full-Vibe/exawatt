import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // shared per-project defaults — no root-level include: tests run ONLY
    // through projects, and each project's include governs its scope
    // (extends CONCATENATES arrays, so a root include would leak into every
    // project and double-run or over-collect)
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      './packages/*',
      // the app itself: renderer (src) + electron main-process units — the
      // packages glob alone silently skipped these
      {
        extends: true,
        test: {
          name: 'app',
          include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            'electron/**/*.{test,spec}.ts',
          ],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
