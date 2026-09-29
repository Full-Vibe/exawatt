import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app-dom',
    globals: true,
    environment: 'jsdom',
    // Node 25 and later define their own global `localStorage`, which is
    // undefined without `--localstorage-file` and shadows jsdom's, so every
    // test touching storage failed on a machine that moved to Node 26. The
    // DOM tests run against jsdom's Storage whatever Node hosts them; the
    // flag is spelled so Node 22 accepts it too.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.{test,spec}.tsx',
      'src/**/*.dom.{test,spec}.ts',
      // See vitest.config.app-node.ts: the company overlay's own tests.
      'company/overlay/web/src/**/*.{test,spec}.tsx',
    ],
    exclude: ['**/node_modules/**', '.company-build/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
