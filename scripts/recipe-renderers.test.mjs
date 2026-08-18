import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  createPathClassifier,
  readPathManifest,
} from './lib/open-source-paths.mjs';
import {
  PRIVATE_DISTRIBUTION_PATHS,
  applyPublicVariantDirectives,
  renderRecipe,
  rendersOutput,
  unrenderedReason,
} from './lib/recipe-renderers.mjs';
import {
  findImageMetadataFindings,
  findTextFindings,
  readForbiddenVocabulary,
} from './public-content-scan.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function manifest() {
  return readPathManifest(path.join(ROOT, OPEN_SOURCE_PATH_MANIFEST));
}

/** Renders every recipe from the working tree, exactly as a projection would. */
async function renderWorkingTree() {
  const declared = await manifest();
  const rendered = new Map();
  for (const [recipeId, recipe] of Object.entries(declared.recipes)) {
    const inputs = new Map();
    for (const output of recipe.outputs) {
      if (!rendersOutput(recipe.kind, output.path)) continue;
      inputs.set(output.path, await readFile(path.join(ROOT, output.path)));
    }
    for (const [file, bytes] of renderRecipe({ recipeId, recipe, inputs })) {
      rendered.set(file, bytes);
    }
  }
  return rendered;
}

test('an omit region disappears from the public variant', () => {
  const source = [
    'keep: 1',
    '# exawatt:public-omit-begin private feed',
    'publish: https://private.example.test',
    '# exawatt:public-omit-end',
    'keep: 2',
    '',
  ].join('\n');
  assert.equal(
    applyPublicVariantDirectives(source, { path: 'fixture.yml' }),
    'keep: 1\nkeep: 2\n'
  );
});

test('a replace region publishes the commented lines at their own indentation', () => {
  const source = [
    'on:',
    '  push:',
    '    # exawatt:public-replace-begin the batch ref is private',
    '    branches: [ci-batches/master]',
    '    # exawatt:public-replace-with',
    '    # branches: [master]',
    '    #',
    '    # tags: []',
    '    # exawatt:public-replace-end',
    '',
  ].join('\n');
  assert.equal(
    applyPublicVariantDirectives(source, { path: 'fixture.yml' }),
    'on:\n  push:\n    branches: [master]\n\n    tags: []\n'
  );
});

test('malformed directives throw instead of guessing', () => {
  const cases = [
    ['# exawatt:public-omit-begin\nkeep\n', /never closed/u],
    ['# exawatt:public-omit-end\n', /closes an unopened omit/u],
    [
      '# exawatt:public-omit-begin\n# exawatt:public-replace-begin\n',
      /inside another one/u,
    ],
    ['# exawatt:public-replace-with\n', /outside a replace/u],
    [
      '# exawatt:public-replace-begin\nx\n# exawatt:public-replace-end\n',
      /closes a replace with no/u,
    ],
    [
      [
        '# exawatt:public-replace-begin',
        'x',
        '# exawatt:public-replace-with',
        'uncommented',
        '# exawatt:public-replace-end',
        '',
      ].join('\n'),
      /does not start with #/u,
    ],
  ];
  for (const [source, expected] of cases) {
    assert.throws(
      () => applyPublicVariantDirectives(source, { path: 'fixture.yml' }),
      expected,
      source
    );
  }
});

test('every GENERATED output either renders or records why it does not', async () => {
  const declared = await manifest();
  const undecided = [];
  for (const [recipeId, recipe] of Object.entries(declared.recipes)) {
    for (const output of recipe.outputs) {
      if (rendersOutput(recipe.kind, output.path)) continue;
      // Throws for a kind nobody has decided about, which is the point: a new
      // recipe cannot be silently dropped from the public repository.
      const reason = unrenderedReason(recipe.kind, output.path);
      if (typeof reason !== 'string' || reason.length < 40) {
        undecided.push(`${recipeId}:${output.path}`);
      }
    }
  }
  assert.deepEqual(undecided, []);
});

test('a renderable output is declared as an input of its own recipe', async () => {
  const declared = await manifest();
  const undeclared = [];
  for (const [recipeId, recipe] of Object.entries(declared.recipes)) {
    for (const output of recipe.outputs) {
      if (!rendersOutput(recipe.kind, output.path)) continue;
      if (!recipe.inputs.includes(output.path)) {
        undeclared.push(`${recipeId}:${output.path}`);
      }
    }
  }
  assert.deepEqual(
    undeclared,
    [],
    'a renderer reads the source blob at its own path, so the recipe must say so'
  );
});

test('rendering the working tree is deterministic', async () => {
  const first = await renderWorkingTree();
  const second = await renderWorkingTree();
  assert.ok(first.size > 0, 'expected at least one renderable output');
  assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
  for (const [file, bytes] of first) {
    assert.ok(bytes.equals(second.get(file)), file);
  }
});

test('no rendered output reaches a PRIVATE path', async () => {
  const declared = await manifest();
  const classify = createPathClassifier(declared);
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const privatePaths = tracked.filter(
    file => classify(file).classification === 'PRIVATE'
  );
  assert.ok(privatePaths.length > 0, 'expected PRIVATE paths to exist');

  // The renderers' forbidden-reference list is only meaningful while those
  // paths really are private. This is what stops it rotting into dead terms.
  for (const declaredPrivate of PRIVATE_DISTRIBUTION_PATHS) {
    assert.equal(
      classify(declaredPrivate).classification,
      'PRIVATE',
      `${declaredPrivate} is named as private by the renderers`
    );
  }

  const leaks = [];
  for (const [file, bytes] of await renderWorkingTree()) {
    const text = bytes.toString('utf8');
    for (const privatePath of privatePaths) {
      if (text.includes(privatePath)) leaks.push(`${file} -> ${privatePath}`);
    }
  }
  assert.deepEqual(leaks, []);
});

test('every rendered output passes the checks the content gate applies', async () => {
  const forbiddenVocabulary = await readForbiddenVocabulary(
    process.env.EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE
  );
  const findings = [];
  for (const [file, bytes] of await renderWorkingTree()) {
    findings.push(...findImageMetadataFindings(bytes, file));
    findings.push(
      ...findTextFindings(bytes.toString('utf8'), file, forbiddenVocabulary)
    );
  }
  assert.deepEqual(findings, []);
});

test('a rendered source file still parses', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'exawatt-rendered-'));
  try {
    for (const [file, bytes] of await renderWorkingTree()) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        assert.ok(parse(bytes.toString('utf8')), file);
        continue;
      }
      const candidate = path.join(scratch, path.basename(file));
      writeFileSync(candidate, bytes);
      assert.doesNotThrow(
        () => execFileSync(process.execPath, ['--check', candidate]),
        file
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the community electron-builder template publishes no private feed', async () => {
  const rendered = await renderWorkingTree();
  const builder = parse(rendered.get('electron-builder.yml').toString('utf8'));
  assert.equal(builder.publish, undefined);
  // The rest of the packaging contract survives: the community variant is the
  // official template minus custody, not a different build.
  assert.equal(builder.directories.output, 'release');
  assert.ok(builder.extraResources.length > 0);
});

test('the public CI variant triggers on its own master and takes no secret', async () => {
  const rendered = await renderWorkingTree();
  const text = rendered.get('.github/workflows/ci.yml').toString('utf8');
  const workflow = parse(text);
  // `on` is YAML 1.1's boolean true when unquoted, which is why this reads
  // both keys rather than trusting one.
  const triggers = workflow.on ?? workflow[true];
  assert.deepEqual(triggers.push.branches, ['master']);
  assert.equal(triggers.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./u);
});
