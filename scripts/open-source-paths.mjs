#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, opendir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  buildSeedPlan,
  projectPublicPathManifest,
  readPathManifest,
  validatePathManifest,
  validateTrackedPathCoverage,
} from './lib/open-source-paths.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function git(args, { encoding = 'utf8' } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: ROOT,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function parseTreeRecords(buffer, label) {
  const entries = [];
  const paths = new Set();
  for (const record of buffer.toString('utf8').split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator === -1) {
      throw new Error('[open-source-paths] malformed ' + label + ' record');
    }
    const metadata = record.slice(0, separator).split(' ');
    const filePath = record.slice(separator + 1);
    let mode;
    let type;
    let object;
    if (label === 'index') {
      [mode, object] = metadata;
      type = 'blob';
      if (metadata[2] !== '0') {
        throw new Error(
          '[open-source-paths] unresolved index stage for ' + filePath
        );
      }
    } else {
      [mode, type, object] = metadata;
    }
    if (paths.has(filePath)) {
      throw new Error('[open-source-paths] duplicate tracked path ' + filePath);
    }
    paths.add(filePath);
    if (type !== 'blob') {
      throw new Error(
        '[open-source-paths] unsupported Git object type ' +
          type +
          ' at ' +
          filePath
      );
    }
    entries.push({ path: filePath, mode, object });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function workingTreeEntries() {
  const stdout = await git(['ls-files', '--stage', '-z'], {
    encoding: 'buffer',
  });
  return parseTreeRecords(stdout, 'index');
}

async function sourceContext(requestedSource) {
  const commit = (
    await git(['rev-parse', '--verify', requestedSource + '^{commit}'])
  ).trim();
  const tree = (await git(['rev-parse', commit + '^{tree}'])).trim();
  const manifestBlob = (
    await git(['rev-parse', commit + ':' + OPEN_SOURCE_PATH_MANIFEST])
  ).trim();
  const records = await git(['ls-tree', '-rz', '--full-tree', commit], {
    encoding: 'buffer',
  });
  const manifestSource = await git(['cat-file', 'blob', manifestBlob]);
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    throw new Error(
      '[open-source-paths] source manifest is invalid JSON: ' + error.message
    );
  }
  validatePathManifest(manifest);
  return {
    manifest,
    entries: parseTreeRecords(records, 'tree'),
    source: {
      commit,
      tree,
      manifestPath: OPEN_SOURCE_PATH_MANIFEST,
      manifestBlob,
    },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function reviewedTreeEntries(root) {
  const entries = [];

  async function walk(directory, prefix = '') {
    const children = [];
    for await (const entry of await opendir(directory)) children.push(entry);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of children) {
      if (prefix === '' && entry.name === '.git') continue;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (details.isSymbolicLink()) {
        entries.push({
          path: relative,
          mode: '120000',
          sha256: sha256(await readlink(absolute)),
        });
        continue;
      }
      if (!details.isFile()) {
        throw new Error(
          '[open-source-paths] reviewed tree contains unsupported entry ' +
            relative
        );
      }
      entries.push({
        path: relative,
        mode: (details.mode & 0o111) === 0 ? '100644' : '100755',
        sha256: sha256(await readFile(absolute)),
      });
    }
  }

  await walk(path.resolve(root));
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('[open-source-paths] ' + name + ' requires a value');
  }
  return value;
}

async function check() {
  const manifest = await readPathManifest(
    path.join(ROOT, OPEN_SOURCE_PATH_MANIFEST)
  );
  const classified = validateTrackedPathCoverage(
    manifest,
    await workingTreeEntries()
  );
  const counts = Object.fromEntries(
    [...new Set(classified.map(entry => entry.classification))]
      .sort()
      .map(classification => [
        classification,
        classified.filter(entry => entry.classification === classification)
          .length,
      ])
  );
  process.stdout.write(
    '[open-source-paths] classified ' +
      classified.length +
      ' tracked paths ' +
      JSON.stringify(counts) +
      '\n'
  );
}

async function plan(args) {
  const requestedSource = option(args, '--source');
  if (!requestedSource) {
    throw new Error('[open-source-paths] plan requires --source <commit>');
  }
  const context = await sourceContext(requestedSource);
  const reviewedTree = option(args, '--reviewed-tree');
  const seedPlan = await buildSeedPlan({
    manifest: context.manifest,
    source: context.source,
    trackedEntries: context.entries,
    readBlob: async object =>
      git(['cat-file', 'blob', object], { encoding: 'buffer' }),
    reviewedOutputs: reviewedTree
      ? await reviewedTreeEntries(reviewedTree)
      : null,
  });
  process.stdout.write(JSON.stringify(seedPlan, null, 2) + '\n');
}

async function project(args) {
  const requestedSource = option(args, '--source');
  if (!requestedSource) {
    throw new Error('[open-source-paths] project requires --source <commit>');
  }
  const context = await sourceContext(requestedSource);
  const classified = validateTrackedPathCoverage(
    context.manifest,
    context.entries
  );
  process.stdout.write(
    JSON.stringify(
      projectPublicPathManifest(context.manifest, classified),
      null,
      2
    ) + '\n'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'check';
  if (command === '--help' || command === 'help') {
    process.stdout.write(
      [
        'Usage:',
        '  pnpm open-source:paths:check',
        '  pnpm open-source:paths:plan -- --source <commit> [--reviewed-tree <dir>]',
        '  pnpm open-source:paths:project -- --source <commit>',
        '',
        'The check fails closed on every unclassified tracked path. A plan',
        'records the exact source commit, tree, manifest blob, Git blobs and',
        'modes. --reviewed-tree additionally locks every reviewed output hash.',
        '',
      ].join('\n')
    );
    return;
  }
  if (command === 'check') return check();
  if (command === 'plan') return plan(args.slice(1));
  if (command === 'project') return project(args.slice(1));
  throw new Error('[open-source-paths] unknown command ' + command);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
