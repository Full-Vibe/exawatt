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
import { git, gitBytes } from './lib/hermetic-git.mjs';
import {
  PRIVATE_COMPANY_PATH_PREFIXES,
  PRIVATE_DISTRIBUTION_PATHS,
  applyPublicVariantDirectives,
  applyPublicVariantJsonDirectives,
  lintPublicMarkdown,
  renderRecipe,
  rendersOutput,
  unrenderedReason,
  renderRecipeOutput,
} from './lib/recipe-renderers.mjs';
import {
  findImageMetadataFindings,
  findTextFindings,
  readForbiddenVocabulary,
  readPartnerConversationTerms,
} from './public-content-scan.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function manifest() {
  return readPathManifest(path.join(ROOT, OPEN_SOURCE_PATH_MANIFEST));
}

function isProjectedPublicManifest(declared) {
  return Object.keys(declared.recipes).length === 0;
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

/**
 * The private source tree renders this path; the projected repository already
 * carries those bytes and deliberately publishes no private recipe inputs.
 */
async function publicBytes(file) {
  const declared = await manifest();
  if (isProjectedPublicManifest(declared)) {
    return readFile(path.join(ROOT, file));
  }
  const rendered = await renderWorkingTree();
  assert.ok(rendered.has(file), `expected ${file} to be rendered publicly`);
  return rendered.get(file);
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

/**
 * The seam rule, BUG-196. A public Markdown document is refused only for a
 * seam its public-variant directives CREATED; one the private author wrote is
 * the docs checks' business (`lintPublicMarkdown`), not publication's.
 */
const DOCUMENT_SET = Object.freeze({
  recipeId: 'public-document-set',
  kind: 'render-public-document-set',
});

function renderDocument(lines, file = 'docs/fixture.md') {
  return renderRecipeOutput({
    ...DOCUMENT_SET,
    path: file,
    source: Buffer.from(lines.join('\n'), 'utf8'),
  }).toString('utf8');
}

function lintDocument(lines, file = 'docs/fixture.md') {
  return lintPublicMarkdown({
    ...DOCUMENT_SET,
    path: file,
    source: Buffer.from(lines.join('\n'), 'utf8'),
  });
}

function refusal(lines) {
  try {
    renderDocument(lines);
  } catch (error) {
    return error;
  }
  return assert.fail('expected the render to be refused');
}

test('an authored double blank line publishes, and the docs lint names its line', () => {
  const lines = ['# Title', '', 'First.', '', '', '## Next', '', 'Body.', ''];
  assert.match(renderDocument(lines), /First\.\n\n\n## Next/u);
  assert.deepEqual(
    lintDocument(lines).map(finding => finding.message),
    [
      'docs/fixture.md line 4 has two blank lines in a row, which the ' +
        'public document renders as a blank-line seam; delete one',
    ]
  );
});

test('an authored heading with no blank line under it publishes, and the docs lint names it', () => {
  const lines = ['# Title', '', '## Section', 'Body.', ''];
  assert.match(renderDocument(lines), /## Section\nBody\./u);
  assert.deepEqual(
    lintDocument(lines).map(finding => [finding.line, finding.kind]),
    [[3, 'unspaced-heading']]
  );
});

test('the recreated 0cbcb226 hunk is no longer a publication refusal', () => {
  // The exact shape: a paragraph, then one extra blank line before a new
  // backlog heading, in a region no directive touches.
  const lines = [
    '# Roadmap',
    '',
    'Richer mixed-state presentation remains deferred.',
    '',
    '',
    '### BUG-163 Spatial ⌘J cannot focus Fleet Agents',
    '',
    'Status: bug · ENG-004',
    '',
  ];
  assert.doesNotThrow(() => renderDocument(lines, 'docs/engineering/roadmap.md'));
  assert.deepEqual(
    lintDocument(lines, 'docs/engineering/roadmap.md').map(
      finding => finding.message
    ),
    [
      'docs/engineering/roadmap.md line 4 has two blank lines in a row, ' +
        'which the public document renders as a blank-line seam; delete one',
    ]
  );
});

test('a region removed with a blank line on each side is still refused', () => {
  const uneven = [
    '# Title',
    '',
    'Public before.',
    '',
    '<!-- exawatt:public-omit-begin private detail -->',
    'Private detail.',
    '<!-- exawatt:public-omit-end -->',
    '',
    'Public after.',
    '',
  ];
  const error = refusal(uneven);
  assert.equal(error.check, 'markdown-seam');
  assert.match(
    error.message,
    /docs\/fixture\.md has a blank-line seam at line \d+ that its public-variant directives created: it joins source line 4 to source line 8/u
  );
  assert.equal(
    error.renderRefusal.check,
    'render-public-document-set/markdown-seam'
  );
  // An authored seam elsewhere must not mask the one the render created,
  // which is what a count of seams in source and output would let happen.
  const masked = refusal(['# Title', '', 'Authored.', '', '', ...uneven.slice(1)]);
  assert.match(masked.message, /that its public-variant directives created/u);
  // And the docs lint does not claim a created seam as authored.
  assert.deepEqual(
    lintDocument(['# Title', '', 'Authored.', '', '', '## Next', '']).map(
      finding => finding.line
    ),
    [4]
  );
});

test('a region that pulls text up under a heading is still refused', () => {
  const error = refusal([
    '## Heading',
    '<!-- exawatt:public-omit-begin private detail -->',
    'Private detail.',
    '',
    '<!-- exawatt:public-omit-end -->',
    'Public text.',
    '',
  ]);
  assert.match(
    error.message,
    /a heading with no blank line under it at line \d+ that its public-variant directives created: it joins source line 1 to source line 6/u
  );
});

test('a replacement that renders a double blank line is refused', () => {
  // Adjacent in the source, but as two comment lines, not two blank lines:
  // the source does not have a double blank line at that spot.
  const inside = refusal([
    '# Title',
    '',
    '<!-- exawatt:public-replace-begin private sentence -->',
    'Private sentence.',
    '<!-- exawatt:public-replace-with -->',
    '<!-- Public sentence. -->',
    '<!-- -->',
    '<!-- -->',
    '<!-- Public after. -->',
    '<!-- exawatt:public-replace-end -->',
    '',
  ]);
  assert.equal(inside.check, 'markdown-seam');
  // Beside a source blank line: not adjacent in the source at all.
  const error = refusal([
    '# Title',
    '',
    '<!-- exawatt:public-replace-begin private sentence -->',
    'Private sentence.',
    '<!-- exawatt:public-replace-with -->',
    '<!-- Public sentence. -->',
    '<!-- -->',
    '<!-- exawatt:public-replace-end -->',
    '',
    'After.',
    '',
  ]);
  assert.equal(error.check, 'markdown-seam');
  assert.match(error.message, /blank-line seam/u);
});

test('a created seam right after an authored one is still found', () => {
  // Four newlines are two seams, and a heading can sit hard under another
  // heading. A search that resumed after each match would stop at the
  // authored seam and miss the created one beside it.
  const blank = refusal([
    'A.',
    '',
    '',
    '<!-- exawatt:public-omit-begin private detail -->',
    'Private detail.',
    '<!-- exawatt:public-omit-end -->',
    '',
    'B.',
    '',
  ]);
  assert.match(blank.message, /joins source line 3 to source line 7/u);
  const heading = refusal([
    '# Title',
    '## Section',
    '<!-- exawatt:public-omit-begin private detail -->',
    'Private detail.',
    '<!-- exawatt:public-omit-end -->',
    'Text.',
    '',
  ]);
  assert.match(heading.message, /joins source line 2 to source line 6/u);
});

/**
 * The rule that published every public commit before BUG-196, frozen here so
 * the property below keeps holding if the live rule ever changes again.
 */
function formerSeamRuleRefuses(rendered) {
  return /\n{3}/u.test(rendered) || /^#{1,6} .*\n[^\n]/mu.test(rendered);
}

/** The former text-level notice placement, frozen for the same reason. */
function formerRendering(source) {
  const notice =
    '<!-- Generated for the public repository by the "public-document-set" recipe. -->';
  const lines = applyPublicVariantDirectives(source, {
    path: 'docs/fixture.md',
  }).split('\n');
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    return [...lines.slice(0, close + 1), notice, ...lines.slice(close + 1)].join(
      '\n'
    );
  }
  return [notice, ...lines].join('\n');
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('the seam rule only relaxes: nothing the former rule published renders differently or is refused', () => {
  // Publication replays history, so a rule change that refused, or rendered
  // differently, any document the former rule published would make already
  // published history unreproducible. Generated documents cover the edges
  // (CR, leading and trailing blanks, four newlines in a row, headings inside
  // replacements) far more densely than the tracked tree does.
  const random = seededRandom(20260924);
  const pick = values => values[Math.floor(random() * values.length)];
  const plain = ['', '', '', 'Text.', '# H', '## H', '#no heading', 'CR\r', ''];
  let published = 0;
  let newlyPublished = 0;
  for (let round = 0; round < 4000; round += 1) {
    const lines =
      random() < 0.2 ? ['---', 'exawatt-roadmap: v2', '---'] : [];
    const length = 1 + Math.floor(random() * 12);
    for (let index = 0; index < length; index += 1) {
      const shape = random();
      if (shape < 0.15) {
        lines.push(
          '<!-- exawatt:public-omit-begin x -->',
          pick(plain),
          pick(plain),
          '<!-- exawatt:public-omit-end -->'
        );
      } else if (shape < 0.25) {
        lines.push(
          '<!-- exawatt:public-replace-begin x -->',
          pick(plain),
          '<!-- exawatt:public-replace-with -->',
          pick(['<!-- -->', '<!-- Text. -->', '<!-- ## H -->']),
          '<!-- exawatt:public-replace-end -->'
        );
      } else {
        lines.push(pick(plain));
      }
    }
    const source = lines.join('\n');
    const former = formerRendering(source);
    let current = null;
    try {
      current = renderDocument(lines);
    } catch (error) {
      assert.equal(error.check, 'markdown-seam', error.message);
    }
    if (!formerSeamRuleRefuses(former)) {
      published += 1;
      assert.equal(current, former, JSON.stringify(source));
    } else if (current !== null) {
      newlyPublished += 1;
      assert.equal(current, former, JSON.stringify(source));
    }
  }
  assert.ok(published > 500, `only ${published} documents exercised the equality`);
  assert.ok(newlyPublished > 100, `only ${newlyPublished} authored seams exercised`);
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
    ['{"exawatt:public-variant":{"omit":{"/nope":"why"}}}', /matches nothing/u],
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

test('every GENERATED output renders into the public repository', async () => {
  const declared = await manifest();
  const unrendered = [];
  for (const [recipeId, recipe] of Object.entries(declared.recipes)) {
    for (const output of recipe.outputs) {
      if (rendersOutput(recipe.kind, output.path)) continue;
      unrendered.push(
        `${recipeId}:${output.path}: ${unrenderedReason(recipe.kind, output.path)}`
      );
    }
  }
  assert.deepEqual(
    unrendered,
    [],
    'once the public repository exists, a path that cannot render must be classified PRIVATE or EXCLUDED rather than silently omitted'
  );
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

test('rendering the source tree is deterministic and the projected tree is final', async () => {
  const declared = await manifest();
  const first = await renderWorkingTree();
  const second = await renderWorkingTree();
  if (isProjectedPublicManifest(declared)) {
    assert.equal(first.size, 0, 'a projected tree must not publish recipes');
    const classify = createPathClassifier(declared);
    const tracked = git(ROOT, ['ls-files', '-z']).split('\0').filter(Boolean);
    assert.ok(tracked.length > 1_000, 'expected a full projected tree');
    assert.deepEqual(
      tracked.filter(file => classify(file).classification !== 'PUBLIC'),
      [],
      'the final projected manifest must classify every delivered path PUBLIC'
    );
  } else {
    assert.ok(first.size > 0, 'expected at least one renderable output');
  }
  assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
  for (const [file, bytes] of first) {
    assert.ok(bytes.equals(second.get(file)), file);
  }
});

test('no rendered output reaches a PRIVATE path', async () => {
  const declared = await manifest();
  const classify = createPathClassifier(declared);
  const tracked = git(ROOT, ['ls-files', '-z']).split('\0').filter(Boolean);
  const privatePaths = tracked.filter(
    file => classify(file).classification === 'PRIVATE'
  );
  if (isProjectedPublicManifest(declared)) {
    assert.deepEqual(privatePaths, []);
    assert.deepEqual([...(await renderWorkingTree())], []);
    return;
  }
  assert.ok(privatePaths.length > 0, 'expected PRIVATE paths in source tree');

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
  // A GENERATED source may cite private research; its rendered bytes may not
  // (BUG-126), so the partner-citation rule runs here on the output.
  const partnerConversationTerms = await readPartnerConversationTerms(ROOT);
  const findings = [];
  for (const [file, bytes] of await renderWorkingTree()) {
    findings.push(...findImageMetadataFindings(bytes, file));
    findings.push(
      ...findTextFindings(bytes.toString('utf8'), file, forbiddenVocabulary, {
        partnerConversationTerms,
      })
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
      // A seam a removed region created already refused the render above;
      // an authored one is the docs lint's, in the next test (BUG-196).
      if (file.endsWith('.md')) continue;
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

/** Every Markdown output of the public document set, with its private source. */
async function publicMarkdownSources() {
  const declared = await manifest();
  const sources = [];
  for (const [recipeId, recipe] of Object.entries(declared.recipes)) {
    for (const output of recipe.outputs) {
      if (!rendersOutput(recipe.kind, output.path)) continue;
      if (!output.path.endsWith('.md')) continue;
      sources.push({
        recipeId,
        kind: recipe.kind,
        path: output.path,
        source: await readFile(path.join(ROOT, output.path)),
      });
    }
  }
  return sources;
}

test('no public Markdown source carries an authored seam', async () => {
  // The authoring lint, where `pnpm docs:check` and the landing checks run
  // it. A finding here refuses a docs change before it reaches master; it can
  // no longer latch publication, which is what an authored double blank line
  // did on 2026-09-23 (BUG-196).
  const findings = [];
  for (const input of await publicMarkdownSources()) {
    findings.push(...lintPublicMarkdown(input).map(entry => entry.message));
  }
  assert.deepEqual(findings, []);
});

test('an extra blank line before a public roadmap heading publishes and is linted', async t => {
  const input = (await publicMarkdownSources()).find(
    entry => entry.path === 'docs/engineering/roadmap.md'
  );
  if (!input) {
    t.skip('the projected public tree renders no recipes');
    return;
  }
  const lines = input.source.toString('utf8').split('\n');
  const heading = lines.findIndex(
    (line, index) => /^### /u.test(line) && lines[index - 1] === ''
  );
  assert.ok(heading > 0, 'expected a public roadmap heading to seam before');
  lines.splice(heading, 0, '');
  const source = Buffer.from(lines.join('\n'), 'utf8');
  assert.doesNotThrow(() => renderRecipeOutput({ ...input, source }));
  // Only the inserted line is new; line numbers after it shift by one.
  const before = lintPublicMarkdown(input).map(entry =>
    entry.line > heading ? entry.line + 1 : entry.line
  );
  assert.deepEqual(
    lintPublicMarkdown({ ...input, source }).map(entry => entry.line),
    [...before, heading].sort((left, right) => left - right)
  );
});

test('the community electron-builder template publishes no private feed', async () => {
  const builder = parse(
    (await publicBytes('electron-builder.yml')).toString('utf8')
  );
  assert.equal(builder.publish, undefined);
  // The rest of the packaging contract survives: the community variant is the
  // official template minus custody, not a different build.
  assert.equal(builder.directories.output, 'release');
  assert.ok(builder.extraResources.length > 0);
});

test('the public CI variant triggers on its own master and takes no secret', async () => {
  const text = (await publicBytes('.github/workflows/ci.yml')).toString('utf8');
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
  const agents = (await publicBytes('AGENTS.md')).toString('utf8');
  assert.match(agents, /open a pull request against `master`/u);
  assert.doesNotMatch(agents, /Do not open pull requests/u);
  // Release custody, the research-storage contract, and the marketing update
  // rule are the three sections decision `0036` §2 keeps company-side.
  assert.doesNotMatch(agents, /## Releasing the macOS app/u);
  assert.doesNotMatch(agents, /docs\/research\/partner-conversations/u);
  assert.doesNotMatch(agents, /docs\/product\/marketing\.md/u);
  // The public test pins the public contract, in both directions.
  const pins = (
    await publicBytes('scripts/delivery-documentation.test.mjs')
  ).toString('utf8');
  assert.match(pins, /open a pull request against `master`/u);
  assert.doesNotMatch(pins, /Do not open pull requests/u);
});

test('the public package.json keeps every dependency and drops private scripts', async () => {
  const publicPackage = JSON.parse(
    (await publicBytes('package.json')).toString('utf8')
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
  for (const name of [
    'invite:issue',
    'feedback:triage',
    'electron:release',
    'security:github:check',
    'test:github-security',
  ]) {
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
  const source = await readFile(new URL('../package.json', import.meta.url));
  const declared = await manifest();
  const rendered = isProjectedPublicManifest(declared)
    ? source
    : renderRecipeOutput({
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
    assert.doesNotMatch(
      text,
      new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u')
    );
  }
  // `docs/research/spatial-memory/README.md` is deliberately PUBLIC, so a
  // blanket ban on the directory name would be wrong: it must survive, or the
  // public repository cannot classify its own file.
  assert.match(text, /docs\/research\/spatial-memory\/README\.md/u);
});

test('the rendered manifest is valid FOR the public tree, not just well formed', async () => {
  // The public repository runs `open-source:paths:check` against its own
  // manifest, and the validator rejects a pattern matching nothing. Two stale
  // classes reached the real repository before this test existed, both found by
  // the public repository's own CI on 2026-08-19:
  //   - an `exclude` naming a directory that is private, so absent publicly
  //   - an exact exception for a GENERATED path whose recipe does not render
  // Well-formedness is not the property that matters; agreement with the tree
  // is.
  const { validatePathManifest, validateTrackedPathCoverage } =
    await import('./lib/open-source-paths.mjs');
  const { buildProjectionPlan } = await import('./lib/public-projection.mjs');
  // This contract compares today's recipe with today's Gate A output set.
  // History/epoch replay has separate repository fixtures; old unpublished
  // rendering failures must not change the premise of this manifest check.
  const plan = await buildProjectionPlan({
    sourceRepo: ROOT,
    sourceSha: 'HEAD',
  });
  const manifestPath = 'scripts/open-source-paths.manifest.json';
  const source = gitBytes(ROOT, ['show', `HEAD:${manifestPath}`]);
  const output = plan.renderedOutputs.find(
    entry => entry.path === manifestPath
  );
  const manifest = JSON.parse(
    output
      ? renderRecipeOutput({
          recipeId: output.recipe,
          kind: output.kind,
          path: manifestPath,
          source,
        }).toString('utf8')
      : source.toString('utf8')
  );
  validatePathManifest(manifest);
  const files = [...plan.copiedOutputs, ...plan.renderedOutputs].map(
    entry => entry.path
  );
  validateTrackedPathCoverage(
    manifest,
    files.map(file => ({ path: file }))
  );
  assert.ok(files.length > 1000, 'expected a full public tree');
});
