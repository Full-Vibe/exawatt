import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONVENTION_FILE_PATTERNS,
  changedSourceFiles,
  consumerFiles,
  findNewUnconsumedExports,
  namedExports,
} from './export-consumers-check.mjs';
import { gitAsync } from './lib/hermetic-git.mjs';

async function git(cwd, ...args) {
  return gitAsync(cwd, args);
}

async function write(root, file, content) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

/** A repository whose first commit is the base every test compares against. */
async function fixtureRepository(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-exports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'fixture@example.com');
  await git(root, 'config', 'user.name', 'Fixture');
  await write(root, 'src/a.ts', 'export function used() {}\nexport const old = 1;\n');
  await write(root, 'src/b.ts', "import { used } from './a';\nused();\n");
  await git(root, 'add', 'src/a.ts', 'src/b.ts');
  await git(root, 'commit', '-q', '-m', 'base');
  const base = await git(root, 'rev-parse', 'HEAD');
  return { root, base };
}

test('named exports are read from declarations and export lists, default excluded', () => {
  const source = [
    'export function alpha() {}',
    'export async function beta() {}',
    'export const gamma = 1;',
    'export let delta = 2;',
    'export class Epsilon {}',
    'export type Zeta = string;',
    'export interface Eta {}',
    'export enum Theta {}',
    'export default function ignored() {}',
    'export default class Ignored {}',
    "export { iota, kappa as lambda, type Mu, default } from './x';",
    'export type { Nu };',
    'const notExported = 3;',
  ].join('\n');
  assert.deepEqual(
    namedExports(source).map(entry => entry.name),
    ['alpha', 'beta', 'gamma', 'delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'iota', 'lambda', 'Mu', 'Nu']
  );
  assert.deepEqual(namedExports(source)[2], { name: 'gamma', line: 3 });
});

test('only exports added since the base count, and only ones nothing else mentions', async t => {
  const { root, base } = await fixtureRepository(t);
  await write(
    root,
    'src/a.ts',
    [
      'export function used() {}',
      'export const old = 1;',
      'export function orphan() {}',
      'export function adopted() {}',
      'export type OrphanShape = { id: string };',
      'export type AdoptedShape = { id: string };',
    ].join('\n')
  );
  await write(root, 'src/c.ts', "import { adopted, type AdoptedShape } from './a';\nadopted();\n");
  await write(root, 'src/d.tsx', 'export const Widget = () => null;\n');
  await write(root, 'src/d.test.tsx', "import { Widget } from './d';\nWidget();\n");
  await write(root, 'README.md', 'orphan is documented here and that is not a consumer\n');
  await git(root, 'add', 'src/a.ts', 'src/c.ts', 'src/d.tsx', 'src/d.test.tsx', 'README.md');

  const result = await findNewUnconsumedExports({
    root,
    base,
    paths: ['src/a.ts', 'src/c.ts', 'src/d.tsx', 'src/d.test.tsx', 'README.md', 'src/gone.ts'],
  });
  assert.equal(result.checkedFiles, 3);
  assert.equal(result.newExports, 5);
  assert.deepEqual(result.unconsumed, [
    { file: 'src/a.ts', line: 3, name: 'orphan' },
    { file: 'src/a.ts', line: 5, name: 'OrphanShape' },
  ]);
});

test('a brand-new file owes a consumer for every export, and a tracked test is one', async t => {
  const { root, base } = await fixtureRepository(t);
  await write(root, 'scripts/lib/helper.mjs', 'export function forTests() {}\nexport function forNobody() {}\n');
  await write(root, 'scripts/helper.test.mjs', "import { forTests } from './lib/helper.mjs';\nforTests();\n");
  await git(root, 'add', 'scripts/lib/helper.mjs', 'scripts/helper.test.mjs');

  const result = await findNewUnconsumedExports({
    root,
    base,
    paths: ['scripts/lib/helper.mjs', 'scripts/helper.test.mjs'],
  });
  assert.deepEqual(result.unconsumed, [
    { file: 'scripts/lib/helper.mjs', line: 2, name: 'forNobody' },
  ]);
});

test('framework-read files are skipped by filename, never by symbol', async t => {
  const { root, base } = await fixtureRepository(t);
  await write(root, 'src/app/x/page.tsx', 'export const metadata = {};\nexport default function Page() { return null; }\n');
  await write(root, 'src/app/api/y/route.ts', 'export async function GET() {}\n');
  await write(root, 'src/app/x/panel.tsx', 'export const panelMetadata = {};\n');
  await git(root, 'add', 'src/app/x/page.tsx', 'src/app/api/y/route.ts', 'src/app/x/panel.tsx');

  const result = await findNewUnconsumedExports({
    root,
    base,
    paths: ['src/app/x/page.tsx', 'src/app/api/y/route.ts', 'src/app/x/panel.tsx'],
  });
  // `panel.tsx` is not a convention file, so its export is an ordinary one
  // with no consumer.
  assert.deepEqual(result.unconsumed, [
    { file: 'src/app/x/panel.tsx', line: 1, name: 'panelMetadata' },
  ]);
  for (const file of ['next.config.ts', 'vitest.config.app-dom.ts', 'src/proxy.ts', 'types/x.d.ts', 'src/a.test.ts', 'company/overlay/web/src/app/api/z/route.ts']) {
    assert.ok(CONVENTION_FILE_PATTERNS.some(pattern => pattern.test(file)), file);
  }
  assert.ok(!CONVENTION_FILE_PATTERNS.some(pattern => pattern.test('src/lib/config.ts')));
});

test('consumer search is whole-word, code-only, and excludes the declaring file', async t => {
  const { root } = await fixtureRepository(t);
  await write(root, 'src/e.ts', 'export const token = 1;\nexport const tokenizer = 2;\n');
  await write(root, 'src/f.ts', "import { tokenizer } from './e';\ntokenizer;\n");
  await write(root, 'docs/note.md', 'token token token\n');
  await git(root, 'add', 'src/e.ts', 'src/f.ts', 'docs/note.md');
  assert.deepEqual(await consumerFiles(root, 'src/e.ts', 'token'), []);
  assert.deepEqual(await consumerFiles(root, 'src/e.ts', 'tokenizer'), ['src/f.ts']);
});

test('with no explicit paths the changed source files since the base are the subject', async t => {
  const { root, base } = await fixtureRepository(t);
  await write(root, 'src/a.ts', 'export function used() {}\nexport const old = 1;\nexport const fresh = 2;\n');
  await write(root, 'docs/x.md', 'not source\n');
  await git(root, 'add', 'src/a.ts', 'docs/x.md');
  await git(root, 'commit', '-q', '-m', 'change');
  assert.deepEqual(await changedSourceFiles(root, base), ['src/a.ts']);
});
