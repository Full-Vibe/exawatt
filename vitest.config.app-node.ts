import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app-node',
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.ts',
      'electron/**/*.{test,spec}.ts',
      'contracts/conformance/**/*.{test,spec}.ts',
      // ENG-030 WP3: the hosted implementations live in the company overlay,
      // mirroring the repository path they take in a composed tree. Their
      // tests run here so relocating them never means losing their coverage;
      // the glob matches nothing in a public checkout.
      'company/overlay/web/src/**/*.{test,spec}.ts',
    ],
    exclude: [
      'src/**/*.dom.{test,spec}.ts',
      '**/node_modules/**',
      '.company-build/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
