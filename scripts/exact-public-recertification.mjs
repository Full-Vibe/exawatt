#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runExactPublicRecertification } from './lib/exact-public-recertification.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function usage() {
  return [
    'Usage: pnpm open-source:recertify [-- --source <commit> --public-anchor <localrepo>]',
    '',
    'Projects one private commit into a temporary local public repository,',
    'clones it without hardlinks, removes ambient official/service custody,',
    'frozen-installs, and runs the publication, build, runtime, package, and',
    'network gates. Projection never reads or writes the public remote.',
    'A published-snapshot epoch requires --public-anchor pointing to an already',
    'captured local public repository. URLs are rejected; no implicit fetch occurs.',
    '',
    'The final evidence line binds the verified private and public SHAs. All',
    'temporary projection, checkout, HOME, caches, and build output are removed',
    'on success, failure, SIGINT, or SIGTERM.',
    '',
  ].join('\n');
}

export function parseExactPublicArguments(args) {
  let sourceSha = 'HEAD';
  let publicAnchor;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--source' || argument === '--public-anchor') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(
          argument === '--source'
            ? '[exact-public] --source requires a commit'
            : '[exact-public] --public-anchor requires a local repository'
        );
      }
      if (argument === '--source') sourceSha = value;
      else {
        if (/^[a-z][a-z0-9+.-]*:\/\/|^[^/]+@[^:]+:/iu.test(value))
          throw new Error(
            '[exact-public] --public-anchor must be a local repository, not a URL'
          );
        publicAnchor = path.resolve(value);
      }
      index += 1;
      continue;
    }
    throw new Error(`[exact-public] unknown argument ${argument}`);
  }
  return { help: false, sourceSha, ...(publicAnchor ? { publicAnchor } : {}) };
}

async function main() {
  const parsed = parseExactPublicArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage());
    return;
  }
  if (process.platform !== 'darwin') {
    throw new Error(
      '[exact-public] recertification requires macOS because the product and packaged network gate are macOS-only'
    );
  }

  const controller = new AbortController();
  const interrupt = signal => {
    controller.abort(new Error(`[exact-public] interrupted by ${signal}`));
  };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    await runExactPublicRecertification({
      sourceRepo: ROOT,
      sourceSha: parsed.sourceSha,
      publicAnchor: parsed.publicAnchor,
      signal: controller.signal,
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
