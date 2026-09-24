#!/usr/bin/env node
/**
 * Git merge driver `exawatt-append` (BUG-203), for the append-only logs that
 * `.gitattributes` names. Git calls it as
 *
 *   merge-append-docs.mjs %O %A %B %L %P %S %X %Y
 *
 * and reads the merge from %A: exit 0 when it is clean, non-zero when %A
 * holds conflict markers. `scripts/lib/append-merge.mjs` owns the decision.
 *
 * Whatever goes wrong, %A ends up holding git's own result: a driver failure
 * must never leave a conflicted file without its markers.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { decideAppendMerge } from './lib/append-merge.mjs';

const execFileAsync = promisify(execFile);

const [
  basePath,
  oursPath,
  theirsPath,
  markerSize = '7',
  filePath = '',
  ...labels
] = process.argv.slice(2);
const [baseLabel = 'base', oursLabel = 'ours', theirsLabel = 'theirs'] = labels;

/** git's standard three-way merge of the three versions, and its conflict count. */
async function standardMerge({ inPlace = false } = {}) {
  const args = [
    'merge-file',
    `--marker-size=${markerSize}`,
    '-L',
    oursLabel,
    '-L',
    baseLabel,
    '-L',
    theirsLabel,
    ...(inPlace ? [] : ['-p']),
    oursPath,
    basePath,
    theirsPath,
  ];
  try {
    const { stdout } = await execFileAsync('git', args, {
      maxBuffer: 64 * 1024 * 1024,
    });
    return { text: stdout, conflicts: 0 };
  } catch (error) {
    // merge-file exits with the number of conflicts (capped at 127);
    // a negative or signal exit is an error, not a merge.
    if (Number.isInteger(error?.code) && error.code > 0 && error.code < 128) {
      return { text: String(error.stdout ?? ''), conflicts: error.code };
    }
    throw error;
  }
}

async function main() {
  const standard = await standardMerge();
  let decision;
  try {
    const [base, ours, theirs] = await Promise.all(
      [basePath, oursPath, theirsPath].map(file => readFile(file, 'utf8'))
    );
    decision = await decideAppendMerge({
      basePath,
      oursPath,
      theirsPath,
      base,
      ours,
      theirs,
      filePath,
      standard,
      cwd: process.cwd(),
    });
  } catch (error) {
    decision = {
      result: standard.text,
      clean: standard.conflicts === 0,
      note: `${filePath}: the append-only merge could not run (${error.message}); git's merge stands`,
    };
  }
  await writeFile(oursPath, decision.result);
  if (decision.note)
    process.stderr.write(`[exawatt-append] ${decision.note}\n`);
  process.exitCode = decision.clean ? 0 : 1;
}

main().catch(async error => {
  process.stderr.write(
    `[exawatt-append] ${filePath}: ${error.message}; falling back to git merge-file\n`
  );
  try {
    const fallback = await standardMerge({ inPlace: true });
    process.exitCode = fallback.conflicts === 0 ? 0 : 1;
  } catch {
    process.exitCode = 2;
  }
});
