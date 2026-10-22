#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  assertAuditPayload,
  auditCommittedTree,
  auditJson,
  evaluateProductionAudit,
  formatProductionAudit,
  normalizeProductionAudit,
  productionAuditJson,
} from './lib/production-dependency-audit.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/production-audit-baseline.json');

const run = (command, args, options) =>
  execFileAsync(command, args, { ...options, maxBuffer: 32 * 1024 * 1024 });

/**
 * The revision a pull request merges into, from `--base <rev>` or the
 * `EXAWATT_AUDIT_BASE` the CI workflow sets on pull requests only. Empty is
 * absent: a push carries no pull request, so it keeps the zero baseline.
 */
function baseRevision(args) {
  const flag = args.indexOf('--base');
  if (flag !== -1) {
    const value = args[flag + 1]?.trim();
    if (!value) throw new Error('--base needs a revision');
    return value;
  }
  return process.env.EXAWATT_AUDIT_BASE?.trim() || null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      [
        'Usage: pnpm security:audit:prod [-- --json] [-- --base <rev>]',
        '',
        'Audits production dependencies and fails on every advisory unless',
        'the committed baseline documents a verified non-runtime boundary.',
        '',
        'With --base (or EXAWATT_AUDIT_BASE), judges the change against the',
        'tree it merges into: it fails only for an advisory the base does not',
        'already carry, so a change that removes advisories passes.',
        '',
      ].join('\n')
    );
    return;
  }
  const revision = baseRevision(args);
  const [payload, baselineSource, basePayload] = await Promise.all([
    auditJson(run, ROOT),
    readFile(BASELINE, 'utf8'),
    revision
      ? auditCommittedTree(revision, {
          root: ROOT,
          run,
          makeTempDirectory: () =>
            mkdtemp(path.join(tmpdir(), 'exawatt-audit-base-')),
          writeTreeFile: (directory, file, contents) =>
            writeFile(path.join(directory, file), contents),
          removeDirectory: directory =>
            rm(directory, { recursive: true, force: true }),
        })
      : null,
  ]);
  const evaluation = evaluateProductionAudit(
    normalizeProductionAudit(assertAuditPayload(payload, 'the audit')),
    JSON.parse(baselineSource),
    basePayload
      ? {
          base: normalizeProductionAudit(basePayload),
          baseLabel: /^[0-9a-f]{40}$/u.test(revision)
            ? revision.slice(0, 12)
            : revision,
        }
      : {}
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
