#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditPublicGitMetadata,
  readPublicGitMetadata,
  renderPublicMetadataAudit,
} from './lib/public-metadata-policy.mjs';

function fail(message) {
  throw new Error(`[public-metadata] ${message}`);
}

export function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    refs: [],
    format: 'text',
    forbiddenVocabulary: null,
    allowLegacyCommitter: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--allow-legacy-committer') {
      options.allowLegacyCommitter = true;
      continue;
    }
    if (
      ['--repo', '--ref', '--format', '--forbidden-vocabulary'].includes(
        argument
      )
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--'))
        fail(`${argument} requires a value`);
      if (argument === '--ref') options.refs.push(value);
      else if (argument === '--forbidden-vocabulary') {
        options.forbiddenVocabulary = value;
      } else options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  if (!['text', 'json'].includes(options.format)) {
    fail('--format must be text or json');
  }
  return options;
}

export function usage() {
  return `Usage: pnpm open-source:metadata:audit -- [options]

Read-only audit of commit and annotated-tag metadata reachable from a public
projection. The command never rewrites or pushes a ref.

  --repo <path>                    Repository to inspect (default: cwd)
  --ref <name>                     Narrow to one reachable root; repeatable
  --format <text|json>             Redacted report format (default: text)
  --forbidden-vocabulary <path>    Private newline-delimited terms to detect
  --allow-legacy-committer         Preview content findings before policy migration

With no --ref, every local ref is audited. Use a mirror clone when certifying a
remote so branch, automation, and pull-request refs are present locally.

The command exits nonzero when the audit finds metadata that requires a
corrected projection and deliberate reseed. Matched private values are never
printed. EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE supplies the same private
term file as --forbidden-vocabulary.
`;
}

async function readForbiddenVocabulary(file) {
  if (!file) return [];
  return (await readFile(file, 'utf8'))
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

export async function runAudit(options) {
  const vocabularyFile =
    options.forbiddenVocabulary ??
    process.env.EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE ??
    null;
  const forbiddenVocabulary = await readForbiddenVocabulary(vocabularyFile);
  const metadata = await readPublicGitMetadata({
    repo: path.resolve(options.repo),
    refs: options.refs,
  });
  return auditPublicGitMetadata(metadata, {
    forbiddenVocabulary,
    enforceProjectorCommitter: !options.allowLegacyCommitter,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const audit = await runAudit(options);
  process.stdout.write(
    renderPublicMetadataAudit(audit, { format: options.format })
  );
  if (audit.reseedRequired) process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
