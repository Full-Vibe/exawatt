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
    ],
    exclude: ['src/**/*.dom.{test,spec}.ts', '**/node_modules/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
