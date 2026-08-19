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
  PRIVATE_COMPANY_PATH_PREFIXES,
  PRIVATE_DISTRIBUTION_PATHS,
  applyPublicVariantDirectives,
  applyPublicVariantJsonDirectives,
  renderRecipe,
  rendersOutput,
  unrenderedReason,
  renderRecipeOutput,
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

test('a Markdown replacement drops the delimited comment on both sides', () => {
  const source = [
    'Public sentence.',
    '<!-- exawatt:public-replace-begin the partner is private -->',
    'Evidence: partner conversation `2026-08-14-someone`.',
    '<!-- exawatt:public-replace-with -->',
    '<!-- Evidence: a partner conversation. -->',
    '<!-- -->',
    '<!-- Second line. -->',
    '<!-- exawatt:public-replace-end -->',
    '',
  ].join('\n');
  assert.equal(
    applyPublicVariantDirectives(source, { path: 'fixture.md' }),
    'Public sentence.\nEvidence: a partner conversation.\n\nSecond line.\n'
  );
});

test('a JSON document declares its public variant in a reserved member', () => {
  const source = JSON.stringify(
    {
      scripts: { build: 'x', 'invite:issue': 'node scripts/issue-invite.mjs' },
      'exawatt:public-variant': {
        omit: { '/scripts/invite:issue': 'the invite store is hosted' },
        replace: { '/scripts/build': { why: 'public build', value: 'y' } },
      },
    },
    null,
    2
  );
  assert.equal(
    applyPublicVariantJsonDirectives(source, { path: 'fixture.json' }),
    JSON.stringify({ scripts: { build: 'y' } }, null, 2) + '\n'
  );
});

test('a JSON public-variant directive fails closed', () => {
  const cases = [
    ['{}', /must declare its public variant/u],
    [
      '{"exawatt:public-variant":{"omit":{"/nope":"why"}}}',
      /matches nothing/u,
    ],
    [
      '{"a":1,"exawatt:public-variant":{"replace":{"/a":{"why":"w"}}}}',
      /needs a "value"/u,
    ],
  ];
  for (const [source, expected] of cases) {
    assert.throws(
      () => applyPublicVariantJsonDirectives(source, { path: 'fixture.json' }),
      expected,
      source
    );
  }
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

  // The document-set renderer forbids whole path prefixes rather than exact
  // files. Each one must still cover tracked paths, and cover nothing public,
  // or it either rots into a dead term or starts censoring public material.
  for (const prefix of PRIVATE_COMPANY_PATH_PREFIXES) {
    const covered = tracked.filter(file => file.startsWith(prefix));
    assert.ok(covered.length > 0, `${prefix} matches no tracked path`);
    assert.deepEqual(
      covered.filter(file => classify(file).classification !== 'PRIVATE'),
      [],
      `${prefix} covers a path that is not PRIVATE`
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
      if (file.endsWith('.json')) {
        assert.ok(JSON.parse(bytes.toString('utf8')), file);
        continue;
      }
      if (file.endsWith('.md')) {
        const text = bytes.toString('utf8');
        // A removed region must not leave a seam a reader can see.
        assert.doesNotMatch(text, /\n{3}/u, file);
        assert.doesNotMatch(text, /^#{1,6} .*\n[^\n]/mu, file);
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

test('the public agent contract describes the contributor flow, not direct landing', async () => {
  const rendered = await renderWorkingTree();
  const agents = rendered.get('AGENTS.md').toString('utf8');
  assert.match(agents, /open a pull request against `master`/u);
  assert.doesNotMatch(agents, /Do not open pull requests/u);
  // Release custody, the research-storage contract, and the marketing update
  // rule are the three sections decision `0036` §2 keeps company-side.
  assert.doesNotMatch(agents, /## Releasing the macOS app/u);
  assert.doesNotMatch(agents, /docs\/research\/partner-conversations/u);
  assert.doesNotMatch(agents, /docs\/product\/marketing\.md/u);
  // The public test pins the public contract, in both directions.
  const pins = rendered
    .get('scripts/delivery-documentation.test.mjs')
    .toString('utf8');
  assert.match(pins, /open a pull request against `master`/u);
  assert.doesNotMatch(pins, /Do not open pull requests/u);
});

test('the public package.json keeps every dependency and drops private scripts', async () => {
  const rendered = await renderWorkingTree();
  const publicPackage = JSON.parse(
    rendered.get('package.json').toString('utf8')
  );
  const privatePackage = JSON.parse(
    await readFile(path.join(ROOT, 'package.json'), 'utf8')
  );
  // A lockfile is resolver output over the dependency graph, so the public
  // variant may only prune `scripts`; anything else invalidates the lockfile
  // the public repository ships. `regenerate-public-lockfile-after-public-package`
  // records the same reasoning.
  assert.deepEqual(publicPackage.dependencies, privatePackage.dependencies);
  assert.deepEqual(
    publicPackage.devDependencies,
    privatePackage.devDependencies
  );
  assert.equal(publicPackage['exawatt:public-variant'], undefined);
  for (const name of ['invite:issue', 'feedback:triage', 'electron:release']) {
    assert.equal(publicPackage.scripts[name], undefined, name);
  }
  assert.equal(publicPackage.scripts.dev, privatePackage.scripts.dev);
});

test('the public lockfile is the private one, and the premise that allows it holds', async () => {
  // `regenerate-public-lockfile-after-public-package` renders the lockfile
  // verbatim. That is only correct while the public `package.json` prunes
  // NOTHING that pnpm resolves against: pnpm keys importers by dependency
  // graph, so identical dependency sections mean identical resolution.
  //
  // If a future change ever prunes a dependency from the public manifest, this
  // test fails and the recipe must become a real resolver rather than
  // publishing a lockfile that installs a tree nobody built.
  const source = await readFile(
    new URL('../package.json', import.meta.url)
  );
  const rendered = renderRecipeOutput({
    recipeId: 'public-document-set',
    kind: 'render-public-document-set',
    path: 'package.json',
    source,
  });
  const before = JSON.parse(source.toString('utf8'));
  const after = JSON.parse(rendered.toString('utf8'));

  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'pnpm',
    'packageManager',
  ]) {
    assert.deepEqual(
      after[section],
      before[section],
      `public package.json changed ${section}, so the verbatim lockfile is no longer correct`
    );
  }
});

test('the public path manifest keeps only public rules and names no private directory', async () => {
  const source = await readFile(
    new URL('../scripts/open-source-paths.manifest.json', import.meta.url)
  );
  const rendered = renderRecipeOutput({
    recipeId: 'public-path-manifest',
    kind: 'project-public-path-manifest',
    path: 'scripts/open-source-paths.manifest.json',
    source,
  });
  const after = JSON.parse(rendered.toString('utf8'));

  for (const entry of [...after.rules, ...after.exceptions]) {
    assert.ok(
      entry.classification === 'PUBLIC' || entry.classification === 'GENERATED',
      `${entry.id ?? entry.path} is ${entry.classification} and must not be published`
    );
  }
  // No recipes: they declare private inputs, so publishing them would name
  // the very files the manifest exists to keep out.
  // The key stays, required by the schema, but carries nothing.
  assert.deepEqual(after.recipes, {});
  const text = rendered.toString('utf8');
  for (const privatePath of [
    'electron-builder.release.yml',
    'scripts/release-package.mjs',
    'scripts/lib/exawatt-official-distribution.mjs',
    'company/',
    'supabase/',
  ]) {
    assert.doesNotMatch(text, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  // `docs/research/spatial-memory/README.md` is deliberately PUBLIC, so a
  // blanket ban on the directory name would be wrong: it must survive, or the
  // public repository cannot classify its own file.
  assert.match(text, /docs\/research\/spatial-memory\/README\.md/u);
});
