import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app-dom',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.{test,spec}.tsx',
      'src/**/*.dom.{test,spec}.ts',
      // See vitest.config.app-node.ts: the company overlay's own tests.
      'company/overlay/web/src/**/*.{test,spec}.tsx',
    ],
    exclude: ['**/node_modules/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
