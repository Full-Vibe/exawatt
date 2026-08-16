#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  evaluateProductionAudit,
  formatProductionAudit,
  normalizeProductionAudit,
  productionAuditJson,
} from './lib/production-dependency-audit.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/production-audit-baseline.json');

async function liveAudit() {
  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      ['audit', '--prod', '--json'],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      [
        'Usage: pnpm security:audit:prod [-- --json]',
        '',
        'Audits production dependencies and fails on every advisory unless',
        'the committed baseline documents a verified non-runtime boundary.',
        '',
      ].join('\n')
    );
    return;
  }
  const [payload, baselineSource] = await Promise.all([
    liveAudit(),
    readFile(BASELINE, 'utf8'),
  ]);
  const evaluation = evaluateProductionAudit(
    normalizeProductionAudit(payload),
    JSON.parse(baselineSource)
  );
  process.stdout.write(
    args.includes('--json')
      ? productionAuditJson(evaluation)
      : formatProductionAudit(evaluation)
  );
  if (evaluation.status !== 'pass') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`[production-audit] ${error.message}\n`);
  process.exitCode = 1;
});
