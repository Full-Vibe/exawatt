import assert from 'node:assert/strict';
import test from 'node:test';

import { runPublicationChecks } from './publication-check.mjs';

test('publication gate composes every owned checker over the tracked tree', async () => {
  const calls = [];
  await runPublicationChecks({
    root: '/repo',
    trackedPaths: async () => ['plain.ts', 'path with spaces.md'],
    run: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
    },
  });

  assert.deepEqual(calls, [
    { command: 'pnpm', args: ['open-source:paths:check'], cwd: '/repo' },
    {
      command: 'pnpm',
      args: ['content:scan', '--', 'plain.ts', 'path with spaces.md'],
      cwd: '/repo',
    },
    { command: 'pnpm', args: ['security:audit:prod'], cwd: '/repo' },
    { command: 'pnpm', args: ['licenses:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['assets:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['community:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['test:publication'], cwd: '/repo' },
  ]);
});

test('publication gate stops at the first failed checker', async () => {
  const scripts = [];

  await assert.rejects(
    runPublicationChecks({
      trackedPaths: async () => ['tracked.ts'],
      run: async (_command, [script]) => {
        scripts.push(script);
        if (script === 'licenses:check') throw new Error('license mismatch');
      },
    }),
    /license mismatch/u
  );

  assert.deepEqual(scripts, [
    'open-source:paths:check',
    'content:scan',
    'security:audit:prod',
    'licenses:check',
  ]);
});
