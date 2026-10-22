import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { git } from './lib/hermetic-git.mjs';
import {
  checkModuleBoundaries,
  contractTests,
  dependentModules,
  importGraph,
  moduleOwner,
  moduleSelection,
  packageSpecifiers,
  parseModuleManifest,
  publicSurface,
  treeTopology,
  workingTreeTopology,
} from './lib/module-graph.mjs';
import { formatModuleReport } from './modules-check.mjs';
import { programOf, rootProgramFiles } from './type-check-modules.mjs';

/*
 * ENG-039's first mile. A small repository of three declared modules and one
 * undeclared path, so every rule is shown on code it can be read off:
 *
 *   core (node)      packages/core/      entry src/index.ts (re-exports ./model)
 *   board (dom)      src/board/          entry src/board/api.ts, depends on core
 *   app (dom)        src/app-shell/      entry src/app-shell/main.ts, depends on board
 *   undeclared       src/lib/            imports board's api and, deeply, board's internal
 */

function declare(id, fields) {
  return {
    id,
    summary: `${id} owns its files`,
    environment: 'dom',
    entrypoints: [],
    dependsOn: [],
    ...fields,
  };
}

const MANIFEST = {
  schemaVersion: 1,
  fullSuite: ['package.json', 'vitest.config.ts'],
  modules: [
    declare('core', {
      environment: 'node',
      paths: ['packages/core/'],
      entrypoints: ['packages/core/src/index.ts'],
    }),
    declare('board', {
      paths: ['src/board/'],
      entrypoints: ['src/board/api.ts'],
      dependsOn: ['core'],
    }),
    declare('app', {
      paths: ['src/app-shell/'],
      entrypoints: ['src/app-shell/main.ts'],
      dependsOn: ['board'],
    }),
  ],
  integrationTests: [],
};

const SOURCES = {
  'packages/core/package.json': JSON.stringify({
    name: '@fixture/core',
    exports: { '.': { import: './src/index.ts' } },
  }),
  'packages/core/src/index.ts': "export * from './model';\n",
  'packages/core/src/model.ts': 'export const model = 1;\n',
  'packages/core/src/model.test.ts': "import { model } from './model';\n",
  'src/board/api.ts':
    "import { model } from '@fixture/core';\nimport { layout } from './layout.js';\nexport const api = () => layout(model);\n",
  'src/board/layout.ts':
    "import { cell } from './cell';\nexport const layout = (x: number) => cell(x);\n",
  'src/board/cell.ts': 'export const cell = (x: number) => x;\n',
  'src/board/cell.test.ts': "import { cell } from './cell';\n",
  'src/board/api.test.ts': "import { api } from './api';\n",
  'src/board/legend.ts': 'export const legend = 1;\n',
  'src/board/legend.test.ts': "import { legend } from './legend';\n",
  'src/app-shell/main.ts':
    "import { api } from '@/board/api';\nexport const main = api;\n",
  'src/app-shell/main.test.tsx': "import { main } from './main';\n",
  'src/app-shell/unrelated.test.ts': 'export {};\n',
  'src/lib/widget.ts':
    "import { api } from '../board/api';\nimport { legend } from '../board/legend';\nexport const widget = [api, legend];\n",
  'src/lib/widget.test.ts': "import { widget } from './widget';\n",
};

function topologyOf(manifest = MANIFEST, sources = SOURCES) {
  const parsed = parseModuleManifest(JSON.stringify(manifest));
  const files = new Set(Object.keys(sources));
  const specifiers = packageSpecifiers(
    Object.entries(sources).filter(([file]) => file.endsWith('package.json'))
  );
  const code = new Map(
    Object.entries(sources).filter(([file]) => !file.endsWith('.json'))
  );
  const edges = importGraph(code, { specifiers, files });
  return {
    manifest: parsed,
    files,
    edges,
    surface: publicSurface(parsed, edges),
  };
}

function withModule(id, change) {
  return {
    ...MANIFEST,
    modules: MANIFEST.modules.map(entry =>
      entry.id === id ? { ...entry, ...change } : entry
    ),
  };
}

test('the manifest is validated as a document before any graph is read', () => {
  assert.doesNotThrow(() => parseModuleManifest(JSON.stringify(MANIFEST)));
  const refusals = [
    [{ ...MANIFEST, schemaVersion: 2 }, /schemaVersion must be 1/u],
    [withModule('board', { summary: '' }), /summary must say what/u],
    [withModule('board', { environment: 'browser' }), /environment must be/u],
    [withModule('board', { dependsOn: ['nothing'] }), /unknown module nothing/u],
    [withModule('board', { dependsOn: ['board'] }), /depends on itself/u],
    [withModule('app', { paths: ['src/board/'] }), /already owned by board/u],
    [
      {
        ...MANIFEST,
        integrationTests: [{ test: 'src/x.test.ts', modules: ['board'] }],
      },
      /say why it crosses modules/u,
    ],
  ];
  for (const [manifest, refusal] of refusals) {
    assert.throws(() => parseModuleManifest(JSON.stringify(manifest)), refusal);
  }
});

test('a file belongs to the module with its longest matching path entry', () => {
  const manifest = parseModuleManifest(
    JSON.stringify(
      withModule('core', {
        paths: ['packages/core/', 'src/board/cell.ts'],
      })
    )
  );
  const owner = moduleOwner(manifest);
  assert.equal(owner('src/board/cell.ts').id, 'core', 'an exact file wins');
  assert.equal(owner('src/board/layout.ts').id, 'board');
  assert.equal(owner('src/lib/widget.ts'), null);
});

test('the import graph resolves relative, aliased and package imports, and marks re-exports', () => {
  const { edges } = topologyOf();
  const pairs = edges.map(edge => `${edge.from} -> ${edge.to}`);
  for (const expected of [
    'src/board/api.ts -> packages/core/src/index.ts',
    'src/board/api.ts -> src/board/layout.ts',
    'src/app-shell/main.ts -> src/board/api.ts',
    'src/lib/widget.ts -> src/board/legend.ts',
  ]) {
    assert.ok(pairs.includes(expected), expected);
  }
  assert.ok(
    edges.find(edge => edge.from === 'packages/core/src/index.ts').reExport
  );
  assert.ok(!edges.find(edge => edge.from === 'src/board/api.ts').reExport);
});

test('a tree that keeps its declarations passes, and an undeclared deep import only warns', () => {
  const topology = topologyOf();
  const { errors, warnings } = checkModuleBoundaries(topology.manifest, topology);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.map(warning => `${warning.from} -> ${warning.to}`),
    ['src/lib/widget.ts -> src/board/legend.ts']
  );
});

test('a declared module refuses deep imports, undeclared dependencies, cycles and environment mismatches', () => {
  const deep = topologyOf(MANIFEST, {
    ...SOURCES,
    'src/app-shell/main.ts': "import { cell } from '../board/cell';\n",
  });
  assert.deepEqual(
    checkModuleBoundaries(deep.manifest, deep).errors.map(error => error.kind),
    ['deep-import']
  );

  const skipped = topologyOf(MANIFEST, {
    ...SOURCES,
    'src/app-shell/main.ts': "import { model } from '@fixture/core';\n",
  });
  assert.deepEqual(
    checkModuleBoundaries(skipped.manifest, skipped).errors.map(
      error => error.kind
    ),
    ['undeclared-dependency']
  );

  const cyclic = topologyOf(withModule('core', { dependsOn: ['app'] }));
  assert.match(
    checkModuleBoundaries(cyclic.manifest, cyclic).errors.find(
      error => error.kind === 'cycle'
    ).message,
    /app -> board -> core -> app/u
  );

  const environment = topologyOf(withModule('core', { dependsOn: ['board'] }));
  assert.ok(
    checkModuleBoundaries(environment.manifest, environment).errors.some(
      error =>
        error.kind === 'environment' &&
        /core \(node\) cannot depend on board \(dom\)/u.test(error.message)
    )
  );
});

test('a declared integration test may cross modules; a manifest entry that names nothing is refused', () => {
  const crossing = {
    ...SOURCES,
    'src/app-shell/pipeline.test.ts': "import { cell } from '../board/cell';\n",
  };
  const refused = topologyOf(MANIFEST, crossing);
  assert.equal(checkModuleBoundaries(refused.manifest, refused).errors.length, 1);
  const declared = topologyOf(
    {
      ...MANIFEST,
      integrationTests: [
        {
          test: 'src/app-shell/pipeline.test.ts',
          modules: ['app', 'board'],
          why: 'drives the cell layout the shell shows',
        },
      ],
    },
    crossing
  );
  assert.deepEqual(checkModuleBoundaries(declared.manifest, declared).errors, []);

  const stale = topologyOf(
    withModule('board', {
      paths: ['src/board/', 'src/gone/'],
      entrypoints: ['src/board/api.ts', 'src/board/missing.ts'],
      contractTests: ['src/board/nothing/**'],
    })
  );
  const messages = checkModuleBoundaries(stale.manifest, stale).errors.map(
    error => error.message
  );
  assert.ok(messages.some(message => /src\/gone\/ matches no tracked file/u.test(message)));
  assert.ok(messages.some(message => /missing\.ts is not a tracked file/u.test(message)));
  assert.ok(messages.some(message => /nothing\/\*\* matches no tracked file/u.test(message)));
});

test('the public surface is the entrypoints, what they re-export, and what undeclared code imports', () => {
  const { surface } = topologyOf();
  assert.deepEqual([...surface.get('core')].sort(), [
    'packages/core/src/index.ts',
    'packages/core/src/model.ts',
  ]);
  assert.deepEqual([...surface.get('board')].sort(), [
    'src/board/api.ts',
    'src/board/legend.ts',
  ]);
  const manifest = parseModuleManifest(JSON.stringify(MANIFEST));
  assert.deepEqual(dependentModules(manifest, ['core']), ['app', 'board']);
  assert.deepEqual(
    contractTests(manifest.modules.find(entry => entry.id === 'board'), topologyOf().files),
    ['src/board/api.test.ts']
  );
});

test('an internal change owes its module and the contracts that reach it, not the repository', () => {
  const selection = moduleSelection(['src/board/cell.ts'], topologyOf());
  assert.equal(selection.wholeRepo, false);
  assert.deepEqual(selection.modules, ['board']);
  assert.deepEqual(selection.related, []);
  // board's own tests that reach cell, and app's contract test, which reaches
  // board's api; not legend's test, and not the undeclared widget's.
  assert.deepEqual(selection.tests, [
    'src/app-shell/main.test.tsx',
    'src/board/api.test.ts',
    'src/board/cell.test.ts',
  ]);
});

test('a test reached only through type imports is not run for a change, and the boundary still holds for types', () => {
  const sources = {
    ...SOURCES,
    'src/board/kinds.ts': 'export type Kind = number;\n',
    'src/board/shape.test.ts':
      "import type { Kind } from './kinds';\nexport const shape: Kind = 1;\n",
  };
  const topology = topologyOf(MANIFEST, sources);
  assert.equal(
    topology.edges.find(edge => edge.from === 'src/board/shape.test.ts')
      .typeOnly,
    true
  );
  assert.equal(
    topology.edges.find(edge => edge.from === 'src/board/api.ts').typeOnly,
    false
  );
  assert.deepEqual(moduleSelection(['src/board/kinds.ts'], topology).tests, []);

  const typedDeep = topologyOf(MANIFEST, {
    ...sources,
    'src/app-shell/main.ts': "import type { Kind } from '../board/kinds';\n",
  });
  assert.deepEqual(
    checkModuleBoundaries(typedDeep.manifest, typedDeep).errors.map(
      error => error.kind
    ),
    ['deep-import']
  );
});

test('a public-surface, undeclared, removed or manifest change keeps the whole checks and the repository heuristic', () => {
  const surface = moduleSelection(['src/board/api.ts'], topologyOf());
  assert.equal(surface.wholeRepo, true);
  assert.deepEqual(surface.related, ['src/board/api.ts']);
  // Everything that imports api is in `vitest related`'s reach; nothing twice.
  assert.deepEqual(surface.tests, []);
  assert.match(surface.reasons[0], /public surface of board/u);

  const undeclared = moduleSelection(['src/lib/widget.ts'], topologyOf());
  assert.equal(undeclared.wholeRepo, true);
  assert.deepEqual(undeclared.related, ['src/lib/widget.ts']);

  const removed = moduleSelection(['src/board/old-cell.ts'], topologyOf());
  assert.equal(removed.wholeRepo, true);
  assert.match(removed.reasons[0], /left the tree/u);

  const manifest = moduleSelection(['modules.json'], topologyOf());
  assert.equal(manifest.wholeRepo, true);
  assert.equal(manifest.fullSuite, false);

  const shared = moduleSelection(['vitest.config.ts'], topologyOf());
  assert.equal(shared.fullSuite, true);

  const docs = moduleSelection(['docs/notes.md', 'src/board/README.md'], topologyOf());
  assert.equal(docs.wholeRepo, false);
  assert.deepEqual(docs.modules, []);
});

test('the module type-check compiles the module, its integration tests and the importers of what the change reaches', () => {
  const topology = topologyOf();
  // cell reaches board's public api, so app's main (which imports it) and the
  // undeclared widget join; legend's change reaches only legend, which the
  // widget also imports.
  assert.deepEqual(rootProgramFiles(['src/board/cell.ts'], topology), [
    'src/app-shell/main.ts',
    'src/board/api.test.ts',
    'src/board/api.ts',
    'src/board/cell.test.ts',
    'src/board/cell.ts',
    'src/board/layout.ts',
    'src/board/legend.test.ts',
    'src/board/legend.ts',
    'src/lib/widget.ts',
  ]);
  assert.equal(programOf('electron/main/pty/session-manager.ts'), 'electron');
  assert.equal(programOf('scripts/agent-land.mjs'), null);
  assert.equal(programOf('src/board/cell.ts'), 'root');
});

test('the topology of a commit is read from its objects, and the working topology from disk', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'exawatt-module-graph-'));
  try {
    git(root, ['init', '--quiet', '--initial-branch=master']);
    for (const [file, contents] of Object.entries({
      ...SOURCES,
      'modules.json': JSON.stringify(MANIFEST),
    })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    }
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '--no-verify', '-m', 'fixture']);
    const hash = git(root, ['rev-parse', 'HEAD^{tree}']);
    // An uncommitted deep import exists on disk and not in the commit.
    writeFileSync(
      path.join(root, 'src/app-shell/main.ts'),
      "import { cell } from '../board/cell';\n"
    );
    const committed = treeTopology({ root, hash });
    assert.deepEqual(
      checkModuleBoundaries(committed.manifest, committed).errors,
      []
    );
    const working = workingTreeTopology(root);
    assert.deepEqual(
      checkModuleBoundaries(working.manifest, working).errors.map(
        error => error.kind
      ),
      ['deep-import']
    );
    // A tree with no manifest has no topology: the landing then runs the
    // whole checks, as it did before modules existed.
    git(root, ['rm', '--quiet', 'modules.json']);
    git(root, ['commit', '--quiet', '--no-verify', '-m', 'no modules']);
    assert.equal(
      treeTopology({ root, hash: git(root, ['rev-parse', 'HEAD^{tree}']) }),
      null
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the check report names each refusal and summarizes warnings by module', () => {
  const topology = topologyOf();
  const report = formatModuleReport({
    ...topology,
    errors: [{ message: 'src/a.ts imports src/b.ts, which is not an entrypoint of board' }],
    warnings: checkModuleBoundaries(topology.manifest, topology).warnings,
  });
  assert.match(report, /refused: src\/a\.ts imports src\/b\.ts/u);
  assert.match(report, /1 import\(s\) from undeclared paths reach past board's entrypoints/u);
  assert.match(report, /3 modules own \d+ of \d+ production source files; 1 refused, 1 warned/u);
});
