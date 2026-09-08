import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scriptsDirectory = path.join(root, 'scripts');
const INTENTIONAL_DIRECTORIES = new Set(['lib', 'r3f-eval']);

async function packageJson() {
  return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
}

async function documentedNonPackageFiles() {
  const readme = await readFile(
    path.join(scriptsDirectory, 'README.md'),
    'utf8'
  );
  const start = readme.indexOf('## Intentional non-package entrypoints');
  const end = readme.indexOf('## Adding or changing a script', start);
  assert.notEqual(start, -1, 'scripts/README.md lost its exception catalog');
  assert.ok(end > start, 'scripts/README.md exception catalog is unbounded');
  return [...readme.slice(start, end).matchAll(/^(?:\|\s*|-\s*)`([^`]+)`/gm)].map(
    match => match[1]
  );
}

function scriptPaths(command) {
  return [
    ...command.matchAll(/scripts\/[A-Za-z0-9_.\/-]+\.(?:c|cjs|json|mjs)/g),
  ].map(match => match[0]);
}

test('package commands only name script paths that exist', async () => {
  const packageFile = await packageJson();
  const references = Object.entries(packageFile.scripts).flatMap(
    ([commandName, command]) =>
      scriptPaths(command).map(scriptPath => ({ commandName, scriptPath }))
  );

  assert.ok(
    references.length > 0,
    'expected package-backed script entrypoints'
  );
  for (const { commandName, scriptPath } of references) {
    await assert.doesNotReject(
      access(path.join(root, scriptPath)),
      `${commandName} references missing ${scriptPath}`
    );
    assert.doesNotMatch(
      scriptPath,
      /^scripts\/lib\//,
      `${commandName} exposes a library file instead of an entrypoint`
    );
  }
});

test('every root script test has a package command', async () => {
  const packageFile = await packageJson();
  const commands = Object.values(packageFile.scripts);
  assert.ok(commands.length > 0, 'expected package commands');

  const files = await readdir(scriptsDirectory);
  const testPaths = files
    .filter(file => file.endsWith('.test.mjs'))
    .map(file => `scripts/${file}`)
    .sort();
  const registered = new Set(commands.flatMap(command => scriptPaths(command)));

  assert.deepEqual(
    testPaths.filter(testPath => !registered.has(testPath)),
    [],
    'add every root scripts/*.test.mjs file to a package command'
  );
});

test('every top-level file has a declared invocation class', async () => {
  const packageFile = await packageJson();
  const documented = await documentedNonPackageFiles();
  const intentionalNonPackageFiles = new Set(['README.md', ...documented]);
  const packageBacked = new Set(
    Object.values(packageFile.scripts)
      .flatMap(scriptPaths)
      .filter(scriptPath => path.dirname(scriptPath) === 'scripts')
      .map(scriptPath => path.basename(scriptPath))
  );
  const files = (await readdir(scriptsDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();

  const unclassified = files.filter(
    file => !packageBacked.has(file) && !intentionalNonPackageFiles.has(file)
  );
  assert.deepEqual(
    unclassified,
    [],
    'register a command or document the intentional external/direct consumer in scripts/README.md and this test'
  );

  const staleExceptions = [...intentionalNonPackageFiles]
    .filter(file => !files.includes(file))
    .sort();
  assert.deepEqual(
    staleExceptions,
    [],
    'remove stale non-package entrypoint declarations'
  );
});

test('every top-level directory has a declared role', async () => {
  const directories = (await readdir(scriptsDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  assert.deepEqual(
    directories,
    [...INTENTIONAL_DIRECTORIES].sort(),
    'document a new multi-file script family in scripts/README.md and this test; keep generated output out of scripts/'
  );
});

test('the README catalogs every intentional non-package file', async () => {
  const documented = await documentedNonPackageFiles();
  assert.ok(documented.length > 0, 'expected documented direct consumers');
  assert.equal(
    new Set(documented).size,
    documented.length,
    'scripts/README.md lists a non-package file more than once'
  );
  const files = new Set(await readdir(scriptsDirectory));
  assert.deepEqual(
    documented.filter(file => !files.has(file)),
    [],
    'remove stale direct consumers from scripts/README.md'
  );
});
