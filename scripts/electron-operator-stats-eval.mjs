#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-operator-stats-eval-'));
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: `${base}/agentmaxxing`,
  },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.getByRole('heading', { name: 'Command more.' }).waitFor();

  const result = await page.evaluate(async () => {
    const api = window.electron?.operatorStats;
    if (!api) throw new Error('Operator Stats IPC is unavailable');
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const preview = await api.scan(since, 'America/Los_Angeles');
    return {
      preview,
      serialized: JSON.stringify(preview),
    };
  });

  const forbidden = [
    'localKey',
    'providerSessionId',
    'sourceFile',
    'cwd',
    'gitBranch',
    'prompt',
    'response',
    'transcript',
  ];
  for (const field of forbidden) {
    if (result.serialized.includes(field)) {
      throw new Error(`Renderer preview leaked forbidden field: ${field}`);
    }
  }
  if (
    result.preview.schemaVersion !== 1 ||
    result.preview.consentVersion !== 1 ||
    result.preview.enabled !== true ||
    result.preview.timezone !== 'America/Los_Angeles'
  ) {
    throw new Error('Operator Stats preview contract was malformed');
  }

  console.log(
    `PASS Electron operator stats: ${result.preview.runs.length} sanitized Runs, ${result.preview.days.length} days`
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
