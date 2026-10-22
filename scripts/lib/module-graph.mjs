import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Module-owned verification (ENG-039, first mile).
 *
 * `modules.json` declares the repository's modules: the paths each one owns,
 * its public entrypoints, the modules it may import, its execution
 * environment, and the tests it owns. This file reads that manifest and the
 * import graph of one committed tree, and answers two questions:
 *
 * - Does the tree keep the boundaries the manifest declares? An import from
 *   one declared module into another must name a module its importer depends
 *   on, through one of that module's entrypoints, and the declared
 *   dependencies must form a DAG whose environments are compatible. A path no
 *   module declares is warned about, never refused, until it is declared.
 * - What does a change owe? A change inside a declared module that leaves its
 *   public surface alone is checked by that module's own checks, plus the
 *   contract tests of every module that depends on it. A change to a public
 *   surface, to a path no module declares, or to shared infrastructure keeps
 *   the whole-repository checks it owed before.
 *
 * Everything here is a pure function of one git tree, read from that tree's
 * objects, so the candidate, the rebased queue head and a train each answer
 * for exactly the tree they check.
 */

export const MODULE_MANIFEST = 'modules.json';

const ENVIRONMENTS = new Set(['node', 'dom', 'electron']);

/** What each environment may import: browser and main code both build on
 *  plain Node-safe code, never on each other. */
const ENVIRONMENT_IMPORTS = Object.freeze({
  node: new Set(['node']),
  dom: new Set(['dom', 'node']),
  electron: new Set(['electron', 'node']),
});

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/u;
// Vitest's projects (vitest.config*.ts); `scripts/**` tests run under node --test.
const VITEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/u;
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.d.ts',
  '.mjs',
  '.js',
  '.cjs',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.mjs',
  '/index.js',
];
const RE_EXPORT =
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gu;
// `import type ... from` and `export type ... from`: erased before anything
// runs, so they carry types and never behaviour.
const TYPE_ONLY =
  /^[ \t]*(?:import|export)[ \t]+type[ \t]+[^;'"]*?from[ \t]*['"]([^'"]+)['"]/gmu;

/** A repository-relative glob (`**`, `*`, `?`) as an anchored expression. */
export function globExpression(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith('**/', index)) {
      pattern += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      pattern += '.*';
      index += 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${pattern}$`, 'u');
}

const matchesAny = (expressions, file) =>
  expressions.some(expression => expression.test(file));

function isTestFile(file) {
  return TEST_FILE.test(file);
}

/**
 * The manifest, validated as a document. Graph-dependent rules (that every
 * import keeps the boundaries) are `checkModuleBoundaries`'s.
 */
export function parseModuleManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`${MODULE_MANIFEST} is not JSON: ${error.message}`);
  }
  const problems = [];
  if (manifest?.schemaVersion !== 1)
    problems.push('schemaVersion must be 1');
  const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
  if (modules.length === 0) problems.push('modules must be a non-empty list');
  const ids = new Set();
  const claimed = new Map();
  for (const declared of modules) {
    const where = `module ${declared?.id ?? '(no id)'}`;
    if (typeof declared?.id !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(declared.id))
      problems.push(`${where}: id must be kebab-case`);
    else if (ids.has(declared.id)) problems.push(`${where}: declared twice`);
    ids.add(declared?.id);
    if (!ENVIRONMENTS.has(declared?.environment))
      problems.push(
        `${where}: environment must be one of ${[...ENVIRONMENTS].join(', ')}`
      );
    for (const field of ['paths', 'entrypoints', 'dependsOn']) {
      if (!Array.isArray(declared?.[field]))
        problems.push(`${where}: ${field} must be a list`);
    }
    if (typeof declared?.summary !== 'string' || declared.summary.length === 0)
      problems.push(`${where}: summary must say what the module owns`);
    for (const field of ['contractTests', 'scripts']) {
      if (
        declared?.[field] !== undefined &&
        !(
          Array.isArray(declared[field]) &&
          declared[field].every(value => typeof value === 'string')
        )
      )
        problems.push(`${where}: ${field} must be a list of strings`);
    }
    for (const entry of declared?.paths ?? []) {
      if (claimed.has(entry))
        problems.push(
          `${where}: path ${entry} is already owned by ${claimed.get(entry)}`
        );
      claimed.set(entry, declared?.id);
    }
  }
  for (const declared of modules) {
    for (const dependency of declared?.dependsOn ?? []) {
      if (!ids.has(dependency))
        problems.push(`module ${declared.id}: depends on unknown module ${dependency}`);
      else if (dependency === declared.id)
        problems.push(`module ${declared.id}: depends on itself`);
    }
  }
  for (const entry of manifest?.integrationTests ?? []) {
    if (typeof entry?.test !== 'string' || !Array.isArray(entry?.modules))
      problems.push('integrationTests entries need a test path and a modules list');
    else if (!entry.why)
      problems.push(`integration test ${entry.test}: say why it crosses modules`);
    for (const id of entry?.modules ?? []) {
      if (!ids.has(id))
        problems.push(`integration test ${entry.test}: unknown module ${id}`);
    }
  }
  if (!Array.isArray(manifest?.fullSuite))
    problems.push('fullSuite must list the shared test infrastructure globs');
  if (problems.length > 0)
    throw new Error(
      `${MODULE_MANIFEST} is invalid:\n${problems.map(line => `  ${line}`).join('\n')}`
    );
  return Object.freeze({
    ...manifest,
    modules: modules.map(declared =>
      Object.freeze({ contractTests: [], scripts: [], ...declared })
    ),
    integrationTests: manifest.integrationTests ?? [],
  });
}

/** Which declared module owns a path: the longest matching path entry. A
 *  directory entry ends in `/`; any other entry names one file. */
export function moduleOwner(manifest) {
  const entries = manifest.modules
    .flatMap(declared => declared.paths.map(entry => ({ entry, module: declared })))
    .sort((left, right) => right.entry.length - left.entry.length);
  const cache = new Map();
  return file => {
    if (!cache.has(file)) {
      const owner = entries.find(({ entry }) =>
        entry.endsWith('/') ? file.startsWith(entry) : file === entry
      );
      cache.set(file, owner?.module ?? null);
    }
    return cache.get(file);
  };
}

/** Workspace packages' public specifiers (`@exawatt/core/distribution`) and
 *  the source files they resolve to, from each package.json's `exports`. */
export function packageSpecifiers(packageJsons) {
  const specifiers = new Map();
  for (const [file, text] of packageJsons) {
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof manifest?.name !== 'string') continue;
    const directory = path.posix.dirname(file);
    const exportsField =
      typeof manifest.exports === 'string'
        ? { '.': manifest.exports }
        : (manifest.exports ?? {});
    for (const [subpath, target] of Object.entries(exportsField)) {
      const source =
        typeof target === 'string'
          ? target
          : (target?.import ?? target?.default ?? null);
      if (typeof source !== 'string') continue;
      const specifier =
        subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//u, '')}`;
      specifiers.set(specifier, path.posix.normalize(path.posix.join(directory, source)));
    }
  }
  return specifiers;
}

// The repository's own TypeScript, whatever tree is being read: its
// preprocessor finds every import, export-from, dynamic import and require.
const require = createRequire(import.meta.url);
let typescript = null;
function loadTypeScript() {
  typescript ??= require('typescript');
  return typescript;
}

/**
 * The import edges of `sources` (path → text): `{ from, to, specifier,
 * reExport, typeOnly }` for every import that resolves to a tracked file.
 * Bare package names that are not workspace packages are external and carry
 * no edge. `typeOnly` marks a specifier every import of which is
 * `import type` or `export type`: it decides what a file type-checks
 * against, never what a test runs.
 */
export function importGraph(sources, { specifiers, files }) {
  const ts = loadTypeScript();
  const known = files ?? new Set(sources.keys());
  const resolveBase = base => {
    const stripped = base.replace(/\.[cm]?js$/u, '');
    for (const candidate of [
      ...RESOLVE_SUFFIXES.map(suffix => `${base}${suffix}`),
      ...RESOLVE_SUFFIXES.map(suffix => `${stripped}${suffix}`),
    ]) {
      if (known.has(candidate)) return candidate;
    }
    return null;
  };
  const resolve = (from, specifier) => {
    if (specifiers.has(specifier)) return resolveBase(specifiers.get(specifier));
    if (specifier.startsWith('@/')) return resolveBase(`src/${specifier.slice(2)}`);
    if (specifier.startsWith('.'))
      return resolveBase(
        path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
      );
    return null;
  };
  const edges = [];
  for (const [from, text] of sources) {
    if (!SOURCE_FILE.test(from)) continue;
    const reExported = new Set(
      [...text.matchAll(RE_EXPORT)].map(match => match[1])
    );
    const typeOnly = new Map();
    for (const match of text.matchAll(TYPE_ONLY))
      typeOnly.set(match[1], (typeOnly.get(match[1]) ?? 0) + 1);
    const { importedFiles } = ts.preProcessFile(text, true, true);
    const statements = new Map();
    for (const { fileName } of importedFiles)
      statements.set(fileName, (statements.get(fileName) ?? 0) + 1);
    for (const [specifier, count] of statements) {
      const to = resolve(from, specifier);
      if (!to || to === from) continue;
      edges.push({
        from,
        to,
        specifier,
        reExport: reExported.has(specifier),
        typeOnly: (typeOnly.get(specifier) ?? 0) >= count,
      });
    }
  }
  return edges;
}

/**
 * Every boundary the tree breaks. `errors` refuse: an import between two
 * declared modules that the manifest does not allow, a declared dependency
 * cycle, an environment mismatch, a manifest entry that names nothing.
 * `warnings` are reported, never refused: a path no module declares that
 * reaches past a module's entrypoints, until that path is declared.
 */
export function checkModuleBoundaries(manifest, { edges, files }) {
  const owner = moduleOwner(manifest);
  const byId = new Map(manifest.modules.map(declared => [declared.id, declared]));
  const errors = [];
  const warnings = [];

  for (const declared of manifest.modules) {
    for (const entry of declared.paths) {
      const owns = entry.endsWith('/')
        ? [...files].some(file => file.startsWith(entry))
        : files.has(entry);
      if (!owns)
        errors.push({
          kind: 'manifest',
          module: declared.id,
          message: `module ${declared.id}: path ${entry} matches no tracked file`,
        });
    }
    for (const entrypoint of declared.entrypoints) {
      if (!files.has(entrypoint))
        errors.push({
          kind: 'manifest',
          module: declared.id,
          message: `module ${declared.id}: entrypoint ${entrypoint} is not a tracked file`,
        });
      else if (owner(entrypoint)?.id !== declared.id)
        errors.push({
          kind: 'manifest',
          module: declared.id,
          message: `module ${declared.id}: entrypoint ${entrypoint} belongs to ${owner(entrypoint)?.id ?? 'no module'}`,
        });
    }
    for (const glob of declared.contractTests) {
      const expression = globExpression(glob);
      if (![...files].some(file => expression.test(file)))
        errors.push({
          kind: 'manifest',
          module: declared.id,
          message: `module ${declared.id}: contract test glob ${glob} matches no tracked file`,
        });
    }
    for (const dependency of declared.dependsOn) {
      const target = byId.get(dependency);
      if (target && !ENVIRONMENT_IMPORTS[declared.environment].has(target.environment))
        errors.push({
          kind: 'environment',
          module: declared.id,
          message: `module ${declared.id} (${declared.environment}) cannot depend on ${dependency} (${target.environment})`,
        });
    }
  }
  for (const entry of manifest.integrationTests) {
    if (!files.has(entry.test))
      errors.push({
        kind: 'manifest',
        module: null,
        message: `integration test ${entry.test} is not a tracked file`,
      });
  }

  for (const cycle of dependencyCycles(manifest)) {
    errors.push({
      kind: 'cycle',
      module: cycle[0],
      message: `declared dependency cycle: ${cycle.join(' -> ')}`,
    });
  }

  const integration = new Map(
    manifest.integrationTests.map(entry => [entry.test, new Set(entry.modules)])
  );
  for (const edge of edges) {
    const from = owner(edge.from);
    const to = owner(edge.to);
    if (!to || from?.id === to.id) continue;
    const isEntrypoint = to.entrypoints.includes(edge.to);
    if (!from) {
      if (!isEntrypoint)
        warnings.push({
          kind: 'undeclared-deep-import',
          module: to.id,
          from: edge.from,
          to: edge.to,
        });
      continue;
    }
    if (integration.get(edge.from)?.has(to.id)) continue;
    if (!from.dependsOn.includes(to.id)) {
      errors.push({
        kind: 'undeclared-dependency',
        module: from.id,
        from: edge.from,
        to: edge.to,
        message: `${edge.from} (${from.id}) imports ${edge.to} (${to.id}), and ${from.id} does not depend on ${to.id}`,
      });
    } else if (!isEntrypoint) {
      errors.push({
        kind: 'deep-import',
        module: from.id,
        from: edge.from,
        to: edge.to,
        message: `${edge.from} (${from.id}) imports ${edge.to}, which is not an entrypoint of ${to.id}`,
      });
    }
  }
  return { errors, warnings };
}

/** Every elementary cycle reachable in the declared dependency graph, each
 *  reported once from its smallest id. */
function dependencyCycles(manifest) {
  const graph = new Map(
    manifest.modules.map(declared => [declared.id, declared.dependsOn])
  );
  const cycles = new Map();
  const visit = (start, current, trail) => {
    for (const next of graph.get(current) ?? []) {
      if (next === start) {
        const cycle = [...trail, start];
        const key = [...cycle].slice(0, -1).sort().join(',');
        if (!cycles.has(key)) cycles.set(key, cycle);
      } else if (!trail.includes(next) && next > start) {
        visit(start, next, [...trail, next]);
      }
    }
  };
  for (const id of [...graph.keys()].sort()) visit(id, id, [id]);
  return [...cycles.values()];
}

/** Modules that depend on `ids`, directly or through another module. */
export function dependentModules(manifest, ids) {
  const found = new Set();
  let frontier = new Set(ids);
  while (frontier.size > 0) {
    const next = new Set();
    for (const declared of manifest.modules) {
      if (found.has(declared.id) || ids.includes(declared.id)) continue;
      if (declared.dependsOn.some(dependency => frontier.has(dependency))) {
        found.add(declared.id);
        next.add(declared.id);
      }
    }
    frontier = next;
  }
  return [...found].sort();
}

/**
 * Each module's public surface: its entrypoints, every file an entrypoint
 * re-exports (transitively, inside the module), and every file a path no
 * module declares imports directly. A change to any of these can change what
 * another module or an undeclared path sees, so it is a contract change.
 */
export function publicSurface(manifest, edges) {
  const owner = moduleOwner(manifest);
  const surface = new Map(
    manifest.modules.map(declared => [declared.id, new Set(declared.entrypoints)])
  );
  for (const edge of edges) {
    const to = owner(edge.to);
    if (to && !owner(edge.from)) surface.get(to.id).add(edge.to);
  }
  const reExports = new Map();
  for (const edge of edges) {
    if (!edge.reExport) continue;
    if (!reExports.has(edge.from)) reExports.set(edge.from, []);
    reExports.get(edge.from).push(edge.to);
  }
  for (const [id, files] of surface) {
    const pending = [...files];
    while (pending.length > 0) {
      for (const target of reExports.get(pending.pop()) ?? []) {
        if (owner(target)?.id === id && !files.has(target)) {
          files.add(target);
          pending.push(target);
        }
      }
    }
  }
  return surface;
}

/** Tests colocated with a file: `x.ts` owns `x.test.ts`, `x.test.tsx`, `x.dom.test.ts`. */
function colocatedTests(file, files) {
  const stem = file.replace(/\.[cm]?[jt]sx?$/u, '');
  return ['.test.ts', '.test.tsx', '.dom.test.ts', '.dom.test.tsx']
    .map(suffix => `${stem}${suffix}`)
    .filter(candidate => files.has(candidate));
}

/** A module's contract tests: the tests of its entrypoints, plus any it names. */
export function contractTests(declared, files) {
  const named = declared.contractTests.map(globExpression);
  return [
    ...new Set([
      ...declared.entrypoints.flatMap(entry => colocatedTests(entry, files)),
      ...[...files].filter(file => VITEST_FILE.test(file) && matchesAny(named, file)),
    ]),
  ].sort();
}

/**
 * What a change owes under the module topology.
 *
 * - `fullSuite`: a shared test or configuration path changed, so the whole
 *   Vitest suite runs.
 * - `wholeRepo`: lint and type-check stay whole-repository, because a changed
 *   path is not in a declared module, is a module's public surface, left the
 *   tree, or is the manifest itself (`reasons` says which).
 * - `modules`: the declared modules the change touches.
 * - `tests`: the module closure. Inside each touched module, the tests the
 *   change reaches through the module's own runtime imports (and those
 *   colocated with a changed file). Past the module's edge only contracts: the contract tests
 *   of every module that depends on it, and its declared integration tests,
 *   that import the part of its public surface the change reaches. A test of
 *   an undeclared path is not followed there; the module's own tests of that
 *   surface stand for it.
 * - `related`: the changed files that keep the repository-wide import
 *   heuristic (`vitest related`): undeclared code and public-surface changes.
 */
export function moduleSelection(paths, { manifest, edges, files, surface }) {
  const owner = moduleOwner(manifest);
  const fullSuiteGlobs = manifest.fullSuite.map(globExpression);
  const reasons = new Set();
  const changedByModule = new Map();
  const related = [];
  let fullSuite = false;
  for (const file of [...new Set(paths)].sort()) {
    if (file === MODULE_MANIFEST) {
      reasons.add('the module manifest changed');
      continue;
    }
    if (matchesAny(fullSuiteGlobs, file)) {
      fullSuite = true;
      reasons.add(`shared test infrastructure changed (${file})`);
      continue;
    }
    if (isInert(file)) continue;
    const declared = owner(file);
    if (!declared) {
      reasons.add(`${file} is in no declared module`);
      if (SOURCE_FILE.test(file)) related.push(file);
      continue;
    }
    if (!changedByModule.has(declared.id)) changedByModule.set(declared.id, []);
    changedByModule.get(declared.id).push(file);
    // A source file the tree no longer holds may have been imported from
    // anywhere in the tree it left; only the whole checks can say who.
    if (SOURCE_FILE.test(file) && !files.has(file))
      reasons.add(`${file} left the tree`);
    if (surface.get(declared.id)?.has(file)) {
      reasons.add(`${file} is public surface of ${declared.id}`);
      if (SOURCE_FILE.test(file)) related.push(file);
    }
  }
  const modules = [...changedByModule.keys()].sort();
  const byId = new Map(manifest.modules.map(declared => [declared.id, declared]));
  const importers = importersOf(edges, { runtime: true });
  const tests = new Set();
  const reachedSurface = [];
  for (const id of modules) {
    const changed = changedByModule.get(id);
    const reached = reverseClosure(
      changed,
      importers,
      file => owner(file)?.id === id
    );
    for (const file of reached) {
      if (VITEST_FILE.test(file)) tests.add(file);
      if (surface.get(id)?.has(file)) reachedSurface.push(file);
    }
    for (const file of changed)
      for (const test of colocatedTests(file, files)) tests.add(test);
  }
  // Contracts across the edge: what imports the surface the change reaches.
  const acrossEdge = reverseClosure(reachedSurface, importers);
  const contracts = new Set([
    ...dependentModules(manifest, modules).flatMap(id =>
      contractTests(byId.get(id), files)
    ),
    ...manifest.integrationTests
      .filter(entry => entry.modules.some(id => changedByModule.has(id)))
      .map(entry => entry.test),
  ]);
  const reachedByIntegration = reverseClosure(
    [...changedByModule.values()].flat(),
    importers
  );
  for (const test of contracts) {
    if (acrossEdge.has(test) || reachedByIntegration.has(test)) tests.add(test);
  }
  // `vitest related` already runs every test that imports a `related` file,
  // so a module test it will reach is not run twice. Following every edge
  // here can only claim more than Vitest reaches through a type-only import,
  // and a test reached only through types cannot change at runtime.
  const covered = reverseClosure(related, importers);
  return {
    fullSuite,
    wholeRepo: reasons.size > 0,
    reasons: [...reasons].sort(),
    modules,
    tests: [...tests]
      .filter(test => VITEST_FILE.test(test) && !covered.has(test))
      .sort(),
    related: [...new Set(related)].sort(),
  };
}

/** Who imports each file. `runtime` leaves out type-only imports: what a
 *  test can observe follows only the imports that survive compilation, as
 *  Vitest's own module graph does. */
function importersOf(edges, { runtime = false } = {}) {
  const importers = new Map();
  for (const edge of edges) {
    if (runtime && edge.typeOnly) continue;
    if (!importers.has(edge.to)) importers.set(edge.to, []);
    importers.get(edge.to).push(edge.from);
  }
  return importers;
}

/** Every file that imports one of `files`, directly or transitively, staying
 *  inside `within` when it is given. */
function reverseClosure(files, importers, within = () => true) {
  const reached = new Set(files);
  const pending = [...files];
  while (pending.length > 0) {
    for (const importer of importers.get(pending.pop()) ?? []) {
      if (!reached.has(importer) && within(importer)) {
        reached.add(importer);
        pending.push(importer);
      }
    }
  }
  return reached;
}

/** Documentation changes owe no lint, type-check or test (the docs lane's
 *  own premise); everything else is owned by a module or keeps the whole
 *  checks. */
export function isInert(file) {
  return /\.md$/u.test(file) || file.startsWith('docs/');
}

/** The tracked files of a tree and the contents of those `wanted` selects,
 *  read from git's objects in one batch. */
function readTree(tree, wanted = file => SOURCE_FILE.test(file)) {
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: tree.root,
      input,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const listing = git(['ls-tree', '-r', '-z', '--full-tree', tree.hash])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(line => {
      const [meta, file] = line.split('\t');
      const [, type, object] = meta.split(' ');
      return { file, type, object };
    })
    .filter(entry => entry.type === 'blob');
  const files = new Set(listing.map(entry => entry.file));
  const selected = listing.filter(entry => wanted(entry.file));
  const sources = new Map();
  if (selected.length > 0) {
    const output = git(
      ['cat-file', '--batch'],
      selected.map(entry => entry.object).join('\n') + '\n'
    );
    let offset = 0;
    for (const entry of selected) {
      const headerEnd = output.indexOf(0x0a, offset);
      const size = Number(output.toString('utf8', offset, headerEnd).split(' ')[2]);
      const start = headerEnd + 1;
      sources.set(entry.file, output.toString('utf8', start, start + size));
      offset = start + size + 1;
    }
  }
  return { files, sources };
}

/** The module topology of a file set and its sources (`readTree`'s shape). */
function topologyOf({ files, sources }) {
  if (!sources.has(MODULE_MANIFEST)) return null;
  const manifest = parseModuleManifest(sources.get(MODULE_MANIFEST));
  const specifiers = packageSpecifiers(
    [...sources].filter(([file]) => /^packages\/[^/]+\/package\.json$/u.test(file))
  );
  const code = new Map([...sources].filter(([file]) => SOURCE_FILE.test(file)));
  const edges = importGraph(code, { specifiers, files });
  return Object.freeze({
    manifest,
    files,
    edges,
    surface: publicSurface(manifest, edges),
  });
}

const TOPOLOGY_SOURCE = file =>
  SOURCE_FILE.test(file) ||
  file === MODULE_MANIFEST ||
  /^packages\/[^/]+\/package\.json$/u.test(file);

/**
 * The module topology of one committed tree: the manifest, the import graph,
 * and each module's public surface. Null when the tree declares no modules.
 */
export function treeTopology(tree) {
  return topologyOf(readTree(tree, TOPOLOGY_SOURCE));
}

/** The same, for the files in a checkout now: tracked and untracked, as
 *  saved, so an author can check an edit before committing it. */
export function workingTreeTopology(root) {
  const files = new Set(
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString('utf8')
      .split('\0')
      .filter(file => file && existsSync(path.join(root, file)))
  );
  const sources = new Map();
  for (const file of files) {
    if (TOPOLOGY_SOURCE(file))
      sources.set(file, readFileSync(path.join(root, file), 'utf8'));
  }
  return topologyOf({ files, sources });
}

/** How much production source the declared modules own (ENG-039's adoption
 *  measure): files outside tests, in a module or not. */
export function ownershipCoverage(manifest, files) {
  const owner = moduleOwner(manifest);
  const production = [...files].filter(
    file =>
      SOURCE_FILE.test(file) &&
      !isTestFile(file) &&
      /^(?:src|electron|packages|scripts)\//u.test(file)
  );
  const owned = production.filter(file => owner(file));
  return { owned: owned.length, production: production.length };
}
