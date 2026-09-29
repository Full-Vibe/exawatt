import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { git } from './lib/hermetic-git.mjs';
import {
  OPEN_SOURCE_PATH_MANIFEST,
  createPathClassifier,
  readPathManifest,
} from './lib/open-source-paths.mjs';
import { renderRecipeOutput, rendersOutput } from './lib/recipe-renderers.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scriptsDirectory = path.join(root, 'scripts');
const INTENTIONAL_DIRECTORIES = new Set(['lib', 'r3f-eval']);

async function packageJson() {
  return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
}

function catalogedNonPackageFiles(readme) {
  const start = readme.indexOf('## Intentional non-package entrypoints');
  const end = readme.indexOf('## Adding or changing a script', start);
  assert.notEqual(start, -1, 'scripts/README.md lost its exception catalog');
  assert.ok(end > start, 'scripts/README.md exception catalog is unbounded');
  return [
    ...readme.slice(start, end).matchAll(/^(?:\|\s*|-\s*)`([^`]+)`/gm),
  ].map(match => match[1]);
}

async function documentedNonPackageFiles() {
  return catalogedNonPackageFiles(
    await readFile(path.join(scriptsDirectory, 'README.md'), 'utf8')
  );
}

function scriptPaths(command) {
  return [
    ...command.matchAll(/scripts\/[A-Za-z0-9_.\/-]+\.(?:c|cjs|json|mjs)/g),
  ].map(match => match[0]);
}

// The two layout rules below, as functions of their inputs, so the private
// tree can hold its public projection to them as well (BUG-233).
function unregisteredTests(scripts, fileNames) {
  const registered = new Set(
    Object.values(scripts).flatMap(command => scriptPaths(command))
  );
  return fileNames
    .filter(file => file.endsWith('.test.mjs'))
    .map(file => `scripts/${file}`)
    .sort()
    .filter(testPath => !registered.has(testPath));
}

function undeclaredInvocations(scripts, fileNames, documented) {
  const intentionalNonPackageFiles = new Set(['README.md', ...documented]);
  const packageBacked = new Set(
    Object.values(scripts)
      .flatMap(scriptPaths)
      .filter(scriptPath => path.dirname(scriptPath) === 'scripts')
      .map(scriptPath => path.basename(scriptPath))
  );
  return {
    unclassified: [...fileNames]
      .sort()
      .filter(
        file =>
          !packageBacked.has(file) && !intentionalNonPackageFiles.has(file)
      ),
    stale: [...intentionalNonPackageFiles]
      .filter(file => !fileNames.includes(file))
      .sort(),
  };
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
  assert.ok(
    Object.values(packageFile.scripts).length > 0,
    'expected package commands'
  );
  assert.deepEqual(
    unregisteredTests(packageFile.scripts, await readdir(scriptsDirectory)),
    [],
    'add every root scripts/*.test.mjs file to a package command'
  );
});

test('every top-level file has a declared invocation class', async () => {
  const packageFile = await packageJson();
  const files = (await readdir(scriptsDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
  const { unclassified, stale } = undeclaredInvocations(
    packageFile.scripts,
    files,
    await documentedNonPackageFiles()
  );
  assert.deepEqual(
    unclassified,
    [],
    'register a command or document the intentional external/direct consumer in scripts/README.md and this test'
  );
  assert.deepEqual(
    stale,
    [],
    'remove stale non-package entrypoint declarations'
  );
});

// Public CI runs this file against the projected tree, whose package.json and
// scripts/README.md are rendered variants and whose scripts/ lacks every
// PRIVATE file. Hold that projection to the same rules here, so a change that
// would fail public CI fails the private landing instead (BUG-233).
test('the public projection keeps the same script layout', async t => {
  const declared = await readPathManifest(
    path.join(root, OPEN_SOURCE_PATH_MANIFEST)
  );
  if (Object.keys(declared.recipes).length === 0) {
    t.skip('this tree is the projection, and the tests above hold it directly');
    return;
  }
  const classify = createPathClassifier(declared);
  const publicBytes = async file => {
    const source = await readFile(path.join(root, file));
    const { classification, recipe } = classify(file);
    if (classification === 'PUBLIC') return source;
    assert.equal(classification, 'GENERATED', `${file} is not delivered`);
    const { kind } = declared.recipes[recipe];
    return renderRecipeOutput({ recipeId: recipe, kind, path: file, source });
  };
  const delivered = git(root, ['ls-files', '-z', '--', 'scripts'])
    .split('\0')
    .filter(Boolean)
    .filter(file => {
      const { classification, recipe } = classify(file);
      if (classification === 'PUBLIC') return true;
      return (
        classification === 'GENERATED' &&
        rendersOutput(declared.recipes[recipe].kind, file)
      );
    });
  const topLevel = delivered
    .filter(file => path.dirname(file) === 'scripts')
    .map(file => path.basename(file));
  const { scripts } = JSON.parse(
    (await publicBytes('package.json')).toString('utf8')
  );
  const readme = (await publicBytes('scripts/README.md')).toString('utf8');

  const deliveredSet = new Set(delivered);
  assert.deepEqual(
    Object.entries(scripts).flatMap(([name, command]) =>
      scriptPaths(command)
        .filter(scriptPath => !deliveredSet.has(scriptPath))
        .map(scriptPath => `${name} -> ${scriptPath}`)
    ),
    [],
    'a public package command names a script the projection does not deliver'
  );
  assert.deepEqual(
    unregisteredTests(scripts, topLevel),
    [],
    'a public scripts/*.test.mjs has no public package command; name only ' +
      'its private companions in the package.json public-variant "without"'
  );
  assert.deepEqual(
    undeclaredInvocations(scripts, topLevel, catalogedNonPackageFiles(readme)),
    { unclassified: [], stale: [] },
    'the public scripts/ layout differs from the one its README and ' +
      'package.json declare'
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
