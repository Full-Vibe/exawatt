#!/usr/bin/env node
/**
 * `pnpm id:next BUG|D|incident|decision [--count <n>]` (BUG-203): allocate
 * the next engineering-log id atomically, so two sessions writing at once can
 * never take the same one. Prints one id per line on stdout.
 */
import { allocateIds, ID_KINDS } from './lib/id-counter.mjs';

const args = process.argv.slice(2).filter(argument => argument !== '--');
const kind = args.find(
  argument => !argument.startsWith('--') && !/^\d+$/u.test(argument)
);
const countIndex = args.indexOf('--count');
const count = countIndex === -1 ? 1 : Number(args[countIndex + 1]);

if (!kind || !ID_KINDS[kind]) {
  process.stderr.write(
    `Usage: pnpm id:next <${Object.keys(ID_KINDS).join('|')}> [--count <n>]\n`
  );
  process.exitCode = 2;
} else {
  allocateIds(process.cwd(), kind, { count })
    .then(({ ids, fresh }) => {
      if (!fresh) {
        process.stderr.write(
          '[id:next] origin could not be read; allocated past the local origin/master and the queue\n'
        );
      }
      process.stdout.write(`${ids.join('\n')}\n`);
    })
    .catch(error => {
      process.stderr.write(`[id:next] ${error.message}\n`);
      process.exitCode = 1;
    });
}
