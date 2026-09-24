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
    EXAWATT_DEV_URL: `${base}/leaderboard`,
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
    const plan = await api.plan({
      since,
      timezone: 'America/Los_Angeles',
      cursor: null,
    });
    return {
      plan,
      serialized: JSON.stringify(plan),
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
      throw new Error(`Renderer plan leaked forbidden field: ${field}`);
    }
  }
  const { plan } = result;
  const DAY_MS = 86_400_000;
  for (const publication of plan.publications) {
    const span =
      (Date.parse(publication.coverage.through) -
        Date.parse(publication.coverage.from)) /
        DAY_MS +
      1;
    if (
      publication.schemaVersion !== 2 ||
      publication.consentVersion !== 1 ||
      publication.enabled !== true ||
      publication.timezone !== 'America/Los_Angeles' ||
      span < 1 ||
      span > 31 ||
      publication.runs.length > 500 ||
      [...publication.days, ...publication.runs].some(
        row =>
          row.localDate < publication.coverage.from ||
          row.localDate > publication.coverage.through
      )
    ) {
      throw new Error('Operator Stats publication contract was malformed');
    }
  }
  if (plan.excluded.length > 0) {
    throw new Error(
      `Operator Stats quarantined rows: ${JSON.stringify(plan.excluded)}`
    );
  }

  const runs = plan.publications.reduce((n, p) => n + p.runs.length, 0);
  const days = plan.publications.reduce((n, p) => n + p.days.length, 0);
  console.log(
    `PASS Electron operator stats: ${plan.publications.length} publications, ${runs} sanitized Runs, ${days} days`
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
