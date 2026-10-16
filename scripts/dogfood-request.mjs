#!/usr/bin/env node

// `pnpm dogfood:request [-- --sha <integrated-sha>]`: ask for ONE dogfood
// build of integrated `master` after a front of landings that skipped
// `--dogfood` (ENG-022, 2026-10-15). It writes the same superseding request
// `agent:land -- --dogfood` writes and starts the same detached worker, so N
// subworkstreams cost one build instead of one each.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { requestMasterDogfood } from './lib/dogfood-queue.mjs';

const argv = process.argv.slice(2).filter(argument => argument !== '--');
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    'Usage: pnpm dogfood:request [-- --sha <integrated-sha>]\n' +
      'Queues one superseding dogfood build of origin/master (or the named integrated SHA).\n' +
      'Installed only when the dogfood_installed metric names that SHA.\n'
  );
  process.exit(0);
}
const shaIndex = argv.indexOf('--sha');
const sha = shaIndex === -1 ? undefined : argv[shaIndex + 1];
if (shaIndex !== -1 && !sha) {
  console.error('--sha needs an integrated commit.');
  process.exit(2);
}
const unknown = argv.filter(
  (argument, index) =>
    !(index === shaIndex || (shaIndex !== -1 && index === shaIndex + 1))
);
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown[0]}. See --help.`);
  process.exit(2);
}

const { stdout } = await promisify(execFile)('git', [
  'rev-parse',
  '--show-toplevel',
]);
const request = await requestMasterDogfood(stdout.trim(), { sha });
console.log(
  `[dogfood-request] build requested for ${request.desiredSha} (request ${request.sequence}). ` +
    'installed=queued is not installed: wait for the dogfood_installed metric naming this SHA.'
);
