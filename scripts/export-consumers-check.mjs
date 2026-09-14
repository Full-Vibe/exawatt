#!/usr/bin/env node

// BUG-137. An export nobody imports is not an API; it is a private function
// carrying a public promise, and every later reader has to ask who depends on
// it before touching it. The 2026-08-17 sweep left 465 exported symbols with
// no consumer outside their module; a recount on 2026-09-13 found 524 across
// 182 files. A repository-wide privatisation pass was judged not worth its
// blast radius — a semantic edit git cannot see, across a dozen live
// worktrees — so the number is held where it is instead.
//
// This check is delta-only. It reads the changed source files, finds the
// named exports that did not exist in the base version of each file, and
// counts whole-repository consumers of each: any tracked code file other than
// the declaring one that mentions the identifier. A new export with none
// fails the landing. Existing consumer-less exports are never counted, so the
// check cannot fail a change for what the tree already carried.
//
// Consumers are counted in code (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`)
// through `git grep`, which sees tracked files only; the landing floor runs on
// a committed tree, so a consumer that exists is a consumer that is counted.
// A test file is a consumer: a `scripts/*.mjs` helper exported for its test is
// exactly the shape this repository uses.
//
// Framework-read exports are not consumers' business: an App Router
// `page.tsx` exports `metadata`, a `route.ts` exports `GET`, and no importer
// will ever name them. Those files are skipped by filename convention rather
// than by symbol name, so a genuinely new convention still has to be added
// here on purpose.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;

const CONSUMER_PATHSPECS = [
  '*.ts',
  '*.tsx',
  '*.mts',
  '*.cts',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
];

const APP_ROUTER_CONVENTIONS =
  'page|layout|template|default|loading|error|global-error|not-found|route|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon';

/** Files whose exports a framework reads by name and no importer ever will. */
export const CONVENTION_FILE_PATTERNS = [
  new RegExp(`(?:^|/)app/(?:.*/)?(?:${APP_ROUTER_CONVENTIONS})\\.[cm]?[jt]sx?$`, 'u'),
  /^src\/proxy\.ts$/u,
  /(?:^|\/)instrumentation(?:-client)?\.[cm]?[jt]s$/u,
  /(?:^|\/)[^/]*\.config(?:\.[^/]*)?\.[cm]?[jt]s$/u,
  /(?:^|\/)vitest\.setup\.[cm]?[jt]s$/u,
  /\.d\.ts$/u,
  // A test's exports are its own business and its own consumer.
  /\.test\.[cm]?[jt]sx?$/u,
];

const DECLARATION_PATTERN =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/gmu;
const LIST_PATTERN = /^export\s+(?:type\s+)?\{([^}]*)\}/gmu;

function isConventionFile(file) {
  return CONVENTION_FILE_PATTERNS.some(pattern => pattern.test(file));
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

/** Named exports of one source text: `[{ name, line }]`, `default` excluded. */
export function namedExports(source) {
  const found = [];
  for (const match of source.matchAll(DECLARATION_PATTERN)) {
    if (/^export\s+(?:declare\s+)?default\b/u.test(match[0])) continue;
    found.push({ name: match[1], line: lineAt(source, match.index) });
  }
  for (const match of source.matchAll(LIST_PATTERN)) {
    const line = lineAt(source, match.index);
    for (const entry of match[1].split(',')) {
      const spec = entry.trim().replace(/^type\s+/u, '');
      if (!spec) continue;
      const exported = spec.includes(' as ')
        ? spec.slice(spec.lastIndexOf(' as ') + 4).trim()
        : spec;
      if (exported === 'default') continue;
      if (/^[A-Za-z_$][\w$]*$/u.test(exported)) found.push({ name: exported, line });
    }
  }
  return found;
}

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function baseSource(root, base, file) {
  try {
    return await git(root, ['show', `${base}:${file}`]);
  } catch {
    // Absent at the base: the file is new, so every export in it is new.
    return '';
  }
}

async function currentSource(root, file) {
  try {
    return await readFile(path.join(root, file), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Tracked code files, other than `file`, that mention `name` as a word. */
export async function consumerFiles(root, file, name) {
  let stdout;
  try {
    stdout = await git(root, [
      'grep',
      '-l',
      '-w',
      '-F',
      '-e',
      name,
      '--',
      ...CONSUMER_PATHSPECS,
    ]);
  } catch (error) {
    // `git grep` exits 1 for "no match" with nothing on stderr; anything
    // else is a real failure and must not read as "no consumers".
    if (error?.code === 1 && !error.stderr) return [];
    throw error;
  }
  return stdout
    .split('\n')
    .filter(Boolean)
    .filter(candidate => candidate !== file);
}

async function defaultBase(root) {
  try {
    return (await git(root, ['merge-base', 'origin/master', 'HEAD'])).trim();
  } catch {
    throw new Error(
      'could not resolve the merge base with origin/master; pass --base <ref>'
    );
  }
}

export async function changedSourceFiles(root, base) {
  const stdout = await git(root, [
    'diff',
    '--name-only',
    '--diff-filter=AMR',
    base,
    '--',
  ]);
  return stdout.split('\n').filter(file => SOURCE_PATTERN.test(file));
}

/**
 * New consumer-less exports in `paths`, relative to `base`.
 *
 * Returns `{ checkedFiles, newExports, unconsumed }` where `unconsumed` is
 * `[{ file, line, name }]`. Paths that are not source files, convention
 * files, or no longer exist are skipped, so the caller can pass a raw
 * changed-path list.
 */
export async function findNewUnconsumedExports({ root = ROOT, base, paths }) {
  const files = [...new Set(paths)]
    .filter(file => SOURCE_PATTERN.test(file))
    .filter(file => !isConventionFile(file))
    .sort();
  let checkedFiles = 0;
  let newExports = 0;
  const unconsumed = [];

  for (const file of files) {
    const source = await currentSource(root, file);
    if (source === null) continue;
    checkedFiles += 1;
    const previous = new Set(
      namedExports(await baseSource(root, base, file)).map(entry => entry.name)
    );
    const seen = new Set();
    for (const entry of namedExports(source)) {
      if (previous.has(entry.name) || seen.has(entry.name)) continue;
      seen.add(entry.name);
      newExports += 1;
      const consumers = await consumerFiles(root, file, entry.name);
      if (consumers.length === 0) unconsumed.push({ file, ...entry });
    }
  }

  return { checkedFiles, newExports, unconsumed };
}

function parseArgs(argv) {
  const paths = [];
  let base;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--base') {
      base = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith('--base=')) {
      base = argument.slice('--base='.length);
      continue;
    }
    paths.push(argument);
  }
  return { base, paths };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    process.stdout.write(
      [
        'Usage: pnpm exports:check -- [--base <ref>] [<changed-path>...]',
        '',
        'Fails on named exports added since <ref> (default: the merge base',
        'with origin/master) that no other tracked code file mentions.',
        'With no paths, checks every source file changed since <ref>.',
        '',
      ].join('\n')
    );
    return;
  }
  const parsed = parseArgs(argv);
  const base = parsed.base ?? (await defaultBase(ROOT));
  const paths =
    parsed.paths.length > 0
      ? parsed.paths
      : await changedSourceFiles(ROOT, base);
  const result = await findNewUnconsumedExports({ root: ROOT, base, paths });

  if (result.unconsumed.length > 0) {
    process.stderr.write(
      [
        `[exports] ${result.unconsumed.length} new export(s) with no consumer outside their file:`,
        ...result.unconsumed.map(
          entry => `  ${entry.file}:${entry.line} ${entry.name}`
        ),
        '',
        'An export nobody imports is a private function with a public promise.',
        'Drop the `export`, or land the consumer in the same change. Exports the',
        `tree already carried are not counted; only ones added since ${base.slice(0, 12)} (BUG-137).`,
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `[exports] checked ${result.checkedFiles} changed source file(s); ${result.newExports} new export(s), every one consumed\n`
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[exports] ${error.message}\n`);
    process.exitCode = 1;
  });
}
