#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const localEnv = fileURLToPath(new URL('../.env.local', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    ...(existsSync(localEnv) ? [`--env-file=${localEnv}`] : []),
    'node_modules/vitest/vitest.mjs',
    'run',
    'src/lib/context-labels/gold.live.test.ts',
    '--maxWorkers=1',
  ],
  {
    cwd: root,
    env: { ...process.env, EXAWATT_CONTEXT_LABEL_GOLD_LIVE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
