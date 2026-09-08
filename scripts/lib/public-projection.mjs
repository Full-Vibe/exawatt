import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  buildSeedPlan,
  createPathClassifier,
  validatePathManifest,
} from './open-source-paths.mjs';
import {
  renderRecipeOutput,
  rendersOutput,
  unrenderedReason,
} from './recipe-renderers.mjs';
import {
  PUBLIC_PROJECTION_EPOCH_PATH,
  readProjectionEpoch,
  validateProjectionEpoch,
} from './public-projection-epoch.mjs';
import {
  auditPublicGitMetadata,
  PUBLIC_METADATA_POLICY_ID,
  projectPublicCommitMetadata,
  readPublicGitMetadata,
} from './public-metadata-policy.mjs';

const execFileAsync = promisify(execFile);

export const GIT_FILTER_REPO = 'git-filter-repo';
export const PUBLIC_PROJECTION_CONTRACT_ID =
  'exawatt-public-projection-v2-prefix-stable-neutral-metadata';

/**
 * Projects the public subset of this repository's history into a standalone
 * Git repository.
 *
 * The projection is a pure function of (source history, Gate A manifest at the
 * source commit). Gate A — `buildSeedPlan` in `open-source-paths.mjs` — is the
 * ONLY classifier; this module never forms its own opinion about what is
 * public. Two consequences the whole two-repository mechanism rests on:
 *
 *   1. determinism — the same `sourceSha` always yields the same `publicSha`;
 *   2. ancestor-stability — projecting an older source commit yields an
 *      ancestor of the projection of a newer one, so the public remote only
 *      ever fast-forwards. `assertFastForward` refuses anything else; the
 *      projector never force-pushes.
 *
 * GENERATED outputs are SUBSTITUTED, never copied. Gate A classifies a set of
 * paths (`electron-builder.yml`, `.github/workflows/ci.yml`, the dogfood
 * tooling, …) GENERATED: the public repository must receive a recipe's
 * rendered bytes, never the private source blob. `recipe-renderers.mjs` makes
 * each renderable recipe an executable, pure function of the source blob at
 * the same path, and this module substitutes them through
 * `git filter-repo --file-info-callback`.
 *
 * That callback shape is not an implementation detail, it is the only
 * ancestor-stable one. A post-projection overlay commit would re-parent the
 * public tip on every landing and destroy the fast-forward property above, so
 * substitution has to happen inside the rewrite, per file, as a function of
 * that file's own source bytes. Every rendered variant is precomputed here in
 * Node — one render per distinct (path, source blob) across the projected
 * history — and the callback only looks the answer up, so the rewrite stays
 * deterministic and the renderers stay JavaScript.
 *
 * Recipes that have no renderer stay excluded and are reported in
 * `unrenderedOutputs` with the recorded reason. Their private blobs are never
 * projected, so that gap is an absence, not a leak. The callback fails closed:
 * a rendered path whose source blob was not precomputed aborts the projection
 * rather than letting a private blob through.
 *
 * A recipe becomes executable at a commit, and revisions older than that
 * cannot be rendered — they predate the directives that declare their public
 * variant. Those revisions are dropped, so the path enters public history
 * where its recipe did, and `skippedRevisions` counts them.
 *
 * "Renders" is not monotone, so the entry boundary is taken from the END of
 * history and never from the first success. A shared document can lose its
 * public-variant directives mid-history — a sibling session edits it without
 * knowing the public variant exists — and get them back later; the same shape
 * appears when a file acquires something private and then declares it
 * (`electron-builder.yml` rendered, stopped when it gained an update feed, and
 * renders again now the feed is declared private). Entering at the first
 * success would make the public file appear, vanish, and reappear, or freeze a
 * stale variant across the gap. `resolveEntryBoundary` is where that is
 * decided, and `entryBoundaries` reports every path whose entry moved.
 */

function fail(message) {
  throw new Error('[public-projection] ' + message);
}

async function git(args, { cwd, encoding = 'utf8' } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

function parseTreeRecords(buffer) {
  const entries = [];
  const seen = new Set();
  for (const record of buffer.toString('utf8').split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator === -1) fail('malformed git ls-tree record');
    const [mode, type, object] = record.slice(0, separator).split(' ');
    const filePath = record.slice(separator + 1);
    if (seen.has(filePath)) fail('duplicate tracked path ' + filePath);
    seen.add(filePath);
    if (type !== 'blob') {
      fail('unsupported Git object type ' + type + ' at ' + filePath);
    }
    entries.push({ path: filePath, mode, object });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function parseBatchBlobOutput(buffer, expectedObjects) {
  const blobs = new Map();
  let offset = 0;
  for (const expected of expectedObjects) {
    const headerEnd = buffer.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      fail('truncated git cat-file batch header for ' + expected);
    }
    const header = buffer.toString('utf8', offset, headerEnd);
    const [object, type, sizeSource, ...extra] = header.split(' ');
    if (extra.length > 0 || object !== expected || type !== 'blob') {
      fail('unexpected git cat-file batch header: ' + header);
    }
    const size = Number(sizeSource);
    if (!Number.isSafeInteger(size) || size < 0) {
      fail('invalid git cat-file blob size for ' + expected);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= buffer.length || buffer[contentEnd] !== 0x0a) {
      fail('truncated git cat-file blob for ' + expected);
    }
    blobs.set(expected, buffer.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  if (offset !== buffer.length) {
    fail('git cat-file batch returned unexpected trailing bytes');
  }
  return blobs;
}

async function readBlobBatch(repo, objects) {
  const expected = [...new Set(objects)];
  if (expected.length === 0) return new Map();
  const child = spawn('git', ['cat-file', '--batch'], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          '[public-projection] git cat-file --batch failed (code ' +
            (code ?? 'none') +
            ', signal ' +
            (signal ?? 'none') +
            '): ' +
            Buffer.concat(stderr).toString('utf8').trim()
        )
      );
    });
  });
  child.stdin.end(expected.join('\n') + '\n');
  await complete;
  return parseBatchBlobOutput(Buffer.concat(stdout), expected);
}

/**
 * Gate A's answer for one source commit: every output path, split into the
 * blobs that copy verbatim and the recipe outputs that do not.
 */
export async function buildProjectionPlan({
  sourceRepo,
  sourceSha,
  manifestPath = OPEN_SOURCE_PATH_MANIFEST,
  blobCache = null,
}) {
  if (typeof sourceRepo !== 'string' || sourceRepo.length === 0) {
    fail('sourceRepo must be a repository path');
  }
  if (typeof sourceSha !== 'string' || sourceSha.length === 0) {
    fail('sourceSha must be a commit-ish');
  }
  const commit = (
    await git(['rev-parse', '--verify', sourceSha + '^{commit}'], {
      cwd: sourceRepo,
    })
  ).trim();
  const tree = (
    await git(['rev-parse', commit + '^{tree}'], { cwd: sourceRepo })
  ).trim();
  const manifestBlob = (
    await git(['rev-parse', commit + ':' + manifestPath], { cwd: sourceRepo })
  ).trim();
  const manifestSource = await git(['cat-file', 'blob', manifestBlob], {
    cwd: sourceRepo,
  });
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    fail('source manifest is invalid JSON: ' + error.message);
  }
  validatePathManifest(manifest);

  const trackedEntries = parseTreeRecords(
    await git(['ls-tree', '-rz', '--full-tree', commit], {
      cwd: sourceRepo,
      encoding: 'buffer',
    })
  );
  const blobs = blobCache ?? new Map();
  const missingObjects = [
    ...new Set(trackedEntries.map(entry => entry.object)),
  ].filter(object => !blobs.has(object));
  const loaded = await readBlobBatch(sourceRepo, missingObjects);
  for (const [object, contents] of loaded) blobs.set(object, contents);
  const plan = await buildSeedPlan({
    manifest,
    source: { commit, tree, manifestPath, manifestBlob },
    trackedEntries,
    readBlob: async object => blobs.get(object),
  });

  const copiedOutputs = plan.outputs
    .filter(output => output.recipe === null)
    .map(output => ({
      path: output.path,
      mode: output.mode,
      sourceObject: output.sourceObject,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const copiedPaths = copiedOutputs.map(output => output.path);
  const generatedOutputs = plan.outputs
    .filter(output => output.recipe !== null)
    .map(output => ({
      path: output.path,
      mode: output.mode,
      recipe: output.recipe,
      kind: manifest.recipes[output.recipe].kind,
      sourceObject:
        trackedEntries.find(entry => entry.path === output.path)?.object ??
        null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const trackedPaths = new Set(trackedEntries.map(entry => entry.path));
  const renderedOutputs = [];
  const unrenderedOutputs = [];
  for (const output of generatedOutputs) {
    if (!rendersOutput(output.kind, output.path)) {
      unrenderedOutputs.push({
        ...output,
        reason: unrenderedReason(output.kind, output.path),
      });
      continue;
    }
    // A renderer is a function of the source blob at its OWN path, which is
    // what lets it run inside filter-repo's per-file callback. An output with
    // no such source, or one the recipe never declared it reads, would make
    // the recipe's declaration a fiction.
    if (!trackedPaths.has(output.path)) {
      fail(
        'recipe ' +
          output.recipe +
          ' renders ' +
          output.path +
          ', which is not tracked at the source commit'
      );
    }
    if (!manifest.recipes[output.recipe].inputs.includes(output.path)) {
      fail(
        'recipe ' +
          output.recipe +
          ' renders ' +
          output.path +
          ' from that path, so it must declare it as an input'
      );
    }
    renderedOutputs.push(output);
  }

  if (copiedPaths.length === 0) fail('Gate A projects no PUBLIC path');
  for (const output of [
    ...copiedPaths,
    ...renderedOutputs.map(entry => entry.path),
  ]) {
    // filter-repo reads --paths-from-file line by line and gives `#`,
    // `regex:`, `glob:`, and `==>` special meaning. `literal:` neutralizes
    // the prefixes; a path that could still be misread is refused outright
    // rather than silently widening the projected set.
    if (/[\r\n]/u.test(output) || output.includes('==>')) {
      fail('output path cannot be expressed as a literal filter: ' + output);
    }
  }
  return {
    sourceSha: commit,
    sourceTree: tree,
    planDigest: plan.planDigest,
    copiedOutputs,
    copiedPaths,
    generatedOutputs,
    renderedOutputs,
    unrenderedOutputs,
  };
}

/**
 * True when `existingRef` is an ancestor of `candidateSha` inside `repo`, so
 * publishing `candidateSha` is a fast-forward. Throws otherwise. A null or
 * absent `existingRef` is the empty-remote case: there is nothing to
 * fast-forward past, so it is allowed. Never force-push in the failing case:
 * a non-ancestor means the manifest reclassified history, which is a
 * deliberate reseed, not a routine landing.
 */
export async function assertFastForward({ repo, candidateSha, existingRef }) {
  if (typeof repo !== 'string' || repo.length === 0) {
    fail('assertFastForward requires a repository path');
  }
  const candidate = (
    await git(['rev-parse', '--verify', candidateSha + '^{commit}'], {
      cwd: repo,
    })
  ).trim();
  if (existingRef === null || existingRef === undefined) return true;
  let existing;
  try {
    existing = (
      await git(['rev-parse', '--verify', existingRef + '^{commit}'], {
        cwd: repo,
      })
    ).trim();
  } catch {
    fail('existing ref does not resolve in the projection: ' + existingRef);
  }
  try {
    await git(['merge-base', '--is-ancestor', existing, candidate], {
      cwd: repo,
    });
  } catch {
    fail(
      'refusing a non-fast-forward projection: ' +
        existing +
        ' is not an ancestor of ' +
        candidate +
        '. A reclassified manifest requires a deliberate reseed.'
    );
  }
  return true;
}

/**
 * The `--file-info-callback` body. filter-repo compiles it as
 * `def file_info_callback(filename, mode, blob_id, value)`, so it sees one
 * file at a time and nothing else — which is exactly the purity the projection
 * needs. All it does is look up the variant this module already rendered.
 *
 * It fails closed: an unknown source blob at a rendered path, or a symlink
 * where a rendered file was expected, aborts filter-repo rather than letting
 * the private blob reach the public repository. A revision before the path's
 * entry boundary is dropped from its commit, which is what makes the path
 * enter public history where it became publishable instead of before it.
 *
 * Dropping a file change does not delete the file: it leaves whatever the
 * parent commit had. That is exactly why the boundary is a boundary — every
 * dropped revision precedes the file's first appearance, so there is nothing
 * for it to leave behind.
 */
const FILE_INFO_CALLBACK = `state = value.data
plan = state.get('exawatt_plan')
if plan is None:
    with open(os.environ['EXAWATT_PROJECTION_RENDER_MAP'], 'rb') as handle:
        plan = __import__('json').load(handle)
    state['exawatt_plan'] = plan
    state['exawatt_blobs'] = {}
name = filename.decode('utf-8', 'surrogateescape')
declared = plan['modes'].get(name)
if declared is None:
    return (filename, mode, blob_id)
if mode == b'120000':
    raise SystemExit('[public-projection] rendered path is a symlink: ' + name)
contents = value.get_contents_by_identifier(blob_id)
key = name + '\\x00' + __import__('hashlib').sha256(contents).hexdigest()
cached = state['exawatt_blobs'].get(key)
if cached is None:
    if key in plan['dropped']:
        return (None, mode, blob_id)
    variant = plan['blobs'].get(key)
    if variant is None:
        raise SystemExit(
            '[public-projection] no rendered variant for ' + name +
            '; re-run the projection so every source blob is rendered'
        )
    with open(variant, 'rb') as handle:
        cached = value.insert_file_with_contents(handle.read())
    state['exawatt_blobs'][key] = cached
return (filename, declared.encode('ascii'), cached)`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function gitInput(args, { cwd, input, env = process.env } = {}) {
  const child = spawn('git', args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          '[public-projection] git ' +
            args[0] +
            ' failed (code ' +
            (code ?? 'none') +
            ', signal ' +
            (signal ?? 'none') +
            '): ' +
            Buffer.concat(stderr).toString('utf8').trim()
        )
      );
    });
  });
  child.stdin.end(input);
  await complete;
  return Buffer.concat(stdout);
}

async function hashBlob(repo, contents) {
  return (
    await gitInput(['hash-object', '-w', '--stdin'], {
      cwd: repo,
      input: contents,
    })
  )
    .toString('utf8')
    .trim();
}

async function writeTree(repo, outputs) {
  const index = path.join(repo, '.git', 'exawatt-projection-index');
  await rm(index, { force: true });
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await gitInput(['read-tree', '--empty'], {
      cwd: repo,
      input: Buffer.alloc(0),
      env,
    });
    const records = outputs.map(output =>
      Buffer.from(`${output.mode} ${output.object}\t${output.path}\0`, 'utf8')
    );
    await gitInput(['update-index', '-z', '--index-info'], {
      cwd: repo,
      input: Buffer.concat(records),
      env,
    });
    return (
      await gitInput(['write-tree'], {
        cwd: repo,
        input: Buffer.alloc(0),
        env,
      })
    )
      .toString('utf8')
      .trim();
  } finally {
    await rm(index, { force: true });
  }
}

function parseCommitIdentity(value, label) {
  const match = /^(.*) <([^<>]*)> ([0-9]+) ([+-][0-9]{4})$/u.exec(value);
  if (!match) fail(`cannot parse ${label} identity`);
  return {
    name: match[1],
    email: match[2],
    date: `${match[3]} ${match[4]}`,
  };
}

async function readCommitMetadata(repo, commit) {
  const raw = await git(['cat-file', 'commit', commit], {
    cwd: repo,
    encoding: 'buffer',
  });
  const boundary = raw.indexOf(Buffer.from('\n\n'));
  if (boundary === -1) fail(`commit ${commit} has no message boundary`);
  const headers = raw.subarray(0, boundary).toString('utf8').split('\n');
  const author = headers.find(line => line.startsWith('author '));
  const committer = headers.find(line => line.startsWith('committer '));
  if (!author || !committer) fail(`commit ${commit} lacks identity headers`);
  return {
    message: raw.subarray(boundary + 2).toString('utf8'),
    author: parseCommitIdentity(author.slice('author '.length), 'author'),
    committer: parseCommitIdentity(
      committer.slice('committer '.length),
      'committer'
    ),
  };
}

async function createCommit(
  repo,
  { tree, parent = null, parents = null, metadata }
) {
  const projected = metadata;
  for (const [label, identity] of [
    ['author', projected.author],
    ['committer', projected.committer],
  ]) {
    if (
      !identity ||
      typeof identity.name !== 'string' ||
      typeof identity.email !== 'string' ||
      typeof identity.date !== 'string'
    ) {
      fail(`metadata policy returned an invalid ${label}`);
    }
  }
  if (typeof projected.message !== 'string') {
    fail('metadata policy returned an invalid message');
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: projected.author.name,
    GIT_AUTHOR_EMAIL: projected.author.email,
    GIT_AUTHOR_DATE: projected.author.date,
    GIT_COMMITTER_NAME: projected.committer.name,
    GIT_COMMITTER_EMAIL: projected.committer.email,
    GIT_COMMITTER_DATE: projected.committer.date,
  };
  const commitParents = parents ?? (parent ? [parent] : []);
  return (
    await gitInput(
      [
        'commit-tree',
        tree,
        ...commitParents.flatMap(commitParent => ['-p', commitParent]),
      ],
      {
        cwd: repo,
        input: Buffer.from(projected.message, 'utf8'),
        env,
      }
    )
  )
    .toString('utf8')
    .trim();
}

/**
 * Reads one `git cat-file --batch-check` answer per request, in order. A
 * request naming a path a commit does not carry answers `<request> missing`,
 * which is a normal outcome for a path added part-way through history.
 */
async function batchCheck(repo, requests) {
  if (requests.length === 0) return [];
  const child = spawn('git', ['cat-file', '--batch-check'], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          '[public-projection] git cat-file --batch-check failed: ' +
            Buffer.concat(stderr).toString('utf8').trim()
        )
      );
    });
  });
  child.stdin.end(requests.join('\n') + '\n');
  await complete;
  const lines = Buffer.concat(stdout)
    .toString('utf8')
    .split('\n')
    .filter(line => line !== '');
  if (lines.length !== requests.length) {
    fail('git cat-file --batch-check answered a different number of requests');
  }
  return lines.map(line => {
    const parts = line.split(' ');
    if (parts.length !== 3 || parts[1] !== 'blob') return null;
    return parts[0];
  });
}

/**
 * The index in `revisions` at which a rendered path ENTERS public history:
 * the start of the last contiguous run of revisions that all render, taken
 * from the newest end.
 *
 * Taken from the end, never from the first success, because "renders" is not
 * monotone. A document can render, lose its public-variant directives to an
 * edit that did not know they were load-bearing, and get them back; a config
 * can render, acquire something private, and render again once that is
 * declared. Entering at the first success would publish a file that appears,
 * vanishes, and reappears — and, worse, the revision that stopped rendering
 * cannot be replaced, so the public repository would hold the PREVIOUS
 * revision's bytes: a stale variant of a file the source has since changed.
 *
 * `revisions` is in ancestor-first topological order, so a suffix of it is
 * closed under descendants: no revision the projection drops can be an
 * ancestor of one it carries, whatever the shape of the DAG.
 *
 * The boundary then moves forward past any blob that appears on both sides of
 * it. filter-repo's callback sees one `(filename, blob)` pair and no commit,
 * so a revision that reverted the file to content the pre-boundary history
 * already had cannot be dropped there and rendered here. Making the two sides
 * disjoint by construction is what keeps that lookup single-valued; it costs
 * a slightly later entry in a case this repository has never yet produced.
 */
export function resolveEntryBoundary(revisions, renders) {
  let boundary = 0;
  for (const [index, revision] of revisions.entries()) {
    if (!renders(revision)) boundary = index + 1;
  }
  for (;;) {
    const before = new Set(
      revisions.slice(0, boundary).map(revision => revision.object)
    );
    let shared = -1;
    for (let index = boundary; index < revisions.length; index += 1) {
      if (before.has(revisions[index].object)) shared = index;
    }
    if (shared === -1) return boundary;
    boundary = shared + 1;
  }
}

/**
 * Renders every GENERATED variant the projected history will need, once per
 * distinct (path, source blob), and writes the lookup the callback reads.
 *
 * Rendering here rather than inside filter-repo is what keeps the renderers in
 * JavaScript next to the manifest that declares them, and it makes the render
 * set explicit: if a source blob at a rendered path is not in this map, the
 * callback aborts instead of guessing.
 *
 * Every revision before a path's entry boundary is dropped whether it renders
 * or not, and every revision from it on renders. Those two together are what
 * make the public file honest: it is absent until it is publishable, and from
 * then on every public revision was rendered from the source revision it sits
 * on. `entryBoundaries` reports each path that entered late, so an operator
 * reads it instead of finding it in a diff.
 */
async function prepareRenderedVariants(workdir, plan) {
  if (plan.renderedOutputs.length === 0) return null;
  // Reverse topological order puts every ancestor before its descendants,
  // which is what makes the entry boundary below a boundary in the history's
  // own order rather than in an arbitrary listing.
  const commits = (
    await git(['rev-list', '--reverse', '--topo-order', plan.sourceSha], {
      cwd: workdir,
    })
  )
    .split('\n')
    .filter(Boolean);
  const requests = [];
  for (const commit of commits) {
    for (const output of plan.renderedOutputs) {
      requests.push(commit + ':' + output.path);
    }
  }
  const answers = await batchCheck(workdir, requests);

  const history = new Map(
    plan.renderedOutputs.map(output => [output.path, []])
  );
  for (const [index, object] of answers.entries()) {
    if (object === null) continue;
    const output = plan.renderedOutputs[index % plan.renderedOutputs.length];
    history.get(output.path).push({
      commit: commits[Math.trunc(index / plan.renderedOutputs.length)],
      object,
    });
  }

  const blobs = await readBlobBatch(workdir, [
    ...new Set([...history.values()].flat().map(revision => revision.object)),
  ]);
  const directory = path.join(workdir, '.git', 'exawatt-rendered');
  await mkdir(directory, { recursive: true });
  const map = { modes: {}, blobs: {}, dropped: {} };
  const entryBoundaries = [];
  let renderedVariants = 0;
  let skippedRevisions = 0;

  for (const output of plan.renderedOutputs) {
    map.modes[output.path] = output.mode;
    const revisions = history.get(output.path);

    // A Git blob id IS its content, so rendering once per distinct object is
    // also rendering once per distinct source content — the same identity the
    // callback keys its lookup on.
    const rendered = new Map();
    const refused = new Map();
    const keys = new Map();
    for (const { object } of revisions) {
      if (keys.has(object)) continue;
      const source = blobs.get(object);
      if (source === undefined) fail('missing source blob ' + object);
      keys.set(object, output.path + '\0' + sha256(source));
      try {
        rendered.set(
          object,
          renderRecipeOutput({
            recipeId: output.recipe,
            kind: output.kind,
            path: output.path,
            source,
          })
        );
      } catch (error) {
        refused.set(object, error);
      }
    }

    const boundary = resolveEntryBoundary(revisions, revision =>
      rendered.has(revision.object)
    );
    if (boundary >= revisions.length) {
      const tip = revisions.at(-1);
      fail(
        'recipe ' +
          output.recipe +
          ' gives the public repository no revision of ' +
          output.path +
          ': ' +
          (revisions.length === 0
            ? 'the path is absent from the projected history'
            : refused.has(tip.object)
              ? 'it does not render at the source commit itself (' +
                tip.commit +
                '), so there is no revision it could enter at. ' +
                refused.get(tip.object).message
              : 'every revision it renders repeats content an unrenderable ' +
                'revision preceded, so the file cannot enter without either ' +
                'a stale variant or a reappearing one')
      );
    }

    let renderableSkipped = 0;
    let lastUnrenderable = null;
    for (let index = 0; index < boundary; index += 1) {
      const revision = revisions[index];
      map.dropped[keys.get(revision.object)] = true;
      if (rendered.has(revision.object)) renderableSkipped += 1;
      else lastUnrenderable = revision;
    }
    skippedRevisions += boundary;

    for (let index = boundary; index < revisions.length; index += 1) {
      const key = keys.get(revisions[index].object);
      // The callback reads `dropped` before `blobs`, so a key on both sides of
      // the boundary would silently drop a revision the public repository must
      // carry — and leave the previous one in its place. `resolveEntryBoundary`
      // makes the two sides disjoint; this refuses to publish if it ever did
      // not.
      if (map.dropped[key]) {
        fail(
          'rendered ' +
            output.path +
            ' would be both dropped and published for one source blob'
        );
      }
      if (map.blobs[key]) continue;
      const file = path.join(directory, sha256(key));
      await writeFile(file, rendered.get(revisions[index].object));
      map.blobs[key] = file;
      renderedVariants += 1;
    }

    if (boundary > 0) {
      entryBoundaries.push({
        path: output.path,
        recipe: output.recipe,
        revisions: revisions.length,
        entryCommit: revisions[boundary].commit,
        skippedRevisions: boundary,
        // The signal that separates a path entering where its recipe became
        // executable (renderableSkipped === 0, the ordinary case) from one
        // whose entry MOVED because a later revision stopped rendering.
        renderableSkipped,
        lastUnrenderableCommit: lastUnrenderable?.commit ?? null,
        reason: lastUnrenderable
          ? refused.get(lastUnrenderable.object).message
          : null,
      });
    }
  }

  const mapPath = path.join(workdir, '.git', 'exawatt-render-map.json');
  await writeFile(mapPath, JSON.stringify(map), 'utf8');
  const callbackPath = path.join(workdir, '.git', 'exawatt-file-info.py');
  await writeFile(callbackPath, FILE_INFO_CALLBACK + '\n', 'utf8');
  return {
    mapPath,
    callbackPath,
    directory,
    renderedVariants,
    skippedRevisions,
    entryBoundaries,
  };
}

async function runFilterRepo(workdir, pathsFile, substitution) {
  try {
    await execFileAsync(
      GIT_FILTER_REPO,
      [
        '--force',
        '--quiet',
        '--paths-from-file',
        pathsFile,
        ...(substitution
          ? ['--file-info-callback', substitution.callbackPath]
          : []),
      ],
      {
        cwd: workdir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: substitution
          ? {
              ...process.env,
              EXAWATT_PROJECTION_RENDER_MAP: substitution.mapPath,
            }
          : process.env,
      }
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        'git-filter-repo is not installed; the public projection needs it ' +
          '(brew install git-filter-repo)'
      );
    }
    fail(
      'git filter-repo failed: ' +
        String(error?.stderr ?? error?.message ?? error).trim()
    );
  }
}

export function parseFilterRepoCommitMap(source) {
  const reverse = new Map();
  const rows = source.split(/\r?\n/u).filter(Boolean);
  if (!/^old\s+new$/u.test(rows.shift() ?? '')) {
    fail('git filter-repo commit map has an unexpected header');
  }
  for (const row of rows) {
    const match = /^([0-9a-f]{40})\s+([0-9a-f]{40})$/u.exec(row);
    if (!match) fail('git filter-repo commit map has a malformed row');
    if (/^0{40}$/u.test(match[2])) continue;
    const sources = reverse.get(match[2]) ?? [];
    sources.push(match[1]);
    reverse.set(match[2], sources.sort());
  }
  return reverse;
}

async function projectedCommitPaths(repo, commit, parents) {
  const comparisons = parents.length > 0 ? parents : [null];
  const paths = new Set();
  for (const parent of comparisons) {
    const args = parent
      ? [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          parent,
          commit,
        ]
      : [
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          commit,
        ];
    for (const file of nullSeparatedPaths(
      await git(args, { cwd: repo, encoding: 'buffer' })
    )) {
      paths.add(file);
    }
  }
  if (paths.size === 0) {
    // A topology-only merge can survive filter-repo without changing its
    // first-parent tree. Its public tree is still the only honest scope for a
    // neutral metadata message; source message bytes are never reused.
    for (const file of nullSeparatedPaths(
      await git(['ls-tree', '-rz', '--name-only', '--full-tree', commit], {
        cwd: repo,
        encoding: 'buffer',
      })
    )) {
      paths.add(file);
    }
  }
  if (paths.size === 0) {
    fail(`surviving projected commit ${commit} has no public path scope`);
  }
  return [...paths].sort();
}

/**
 * Rebuilds filter-repo's surviving DAG with identical trees and topology but
 * policy-owned metadata. This is deliberately WHOLE-HISTORY work: a reseed
 * must remove private identities and prose from the already-published prefix,
 * not merely sanitize commits appended after the continuous-projection epoch.
 */
async function sanitizeLegacyProjectionMetadata({
  workdir,
  metadataProjector = projectPublicCommitMetadata,
}) {
  const tagRefs = (
    await git(['for-each-ref', '--format=%(refname)', 'refs/tags'], {
      cwd: workdir,
    })
  )
    .split('\n')
    .filter(Boolean);
  if (tagRefs.length > 0) {
    fail(
      `whole-history projection refuses ${tagRefs.length} tag(s); tags need ` +
        'their own reviewed public-metadata policy before publication'
    );
  }

  const sourceByFilteredCommit = parseFilterRepoCommitMap(
    await readFile(
      path.join(workdir, '.git', 'filter-repo', 'commit-map'),
      'utf8'
    )
  );
  const rows = (
    await git(
      ['rev-list', '--reverse', '--topo-order', '--parents', 'master'],
      { cwd: workdir }
    )
  )
    .split('\n')
    .filter(Boolean)
    .map(row => row.split(' '));
  const rewritten = new Map();
  for (const [filteredCommit, ...filteredParents] of rows) {
    const sourceCandidates = sourceByFilteredCommit.get(filteredCommit);
    if (!sourceCandidates) {
      fail(`no source commit maps to projected commit ${filteredCommit}`);
    }
    // filter-repo can collapse multiple private-only/no-op source commits onto
    // one surviving projected commit. Neutral metadata does not reuse source
    // bytes or embed this id, so a sorted canonical source id keeps the policy
    // input deterministic without rejecting that ordinary many-to-one map.
    const sourceSha = sourceCandidates[0];
    const parents = filteredParents.map(parent => {
      const rewrittenParent = rewritten.get(parent);
      if (!rewrittenParent) {
        fail(
          `projected parent ${parent} was not sanitized before ${filteredCommit}`
        );
      }
      return rewrittenParent;
    });
    const publicPaths = await projectedCommitPaths(
      workdir,
      filteredCommit,
      filteredParents
    );
    const sourceMetadata = await readCommitMetadata(workdir, filteredCommit);
    const metadata = await metadataProjector({
      sourceSha,
      ...sourceMetadata,
      publicChange: { hasChanges: true, paths: publicPaths },
      privateChange: { hasChanges: false, paths: [] },
    });
    const tree = (
      await git(['rev-parse', `${filteredCommit}^{tree}`], { cwd: workdir })
    ).trim();
    rewritten.set(
      filteredCommit,
      await createCommit(workdir, { tree, parents, metadata })
    );
  }

  const previousMaster = (
    await git(['rev-parse', 'refs/heads/master^{commit}'], { cwd: workdir })
  ).trim();
  const publicSha = rewritten.get(previousMaster);
  if (!publicSha) fail('filtered public master was not metadata-sanitized');
  await git(['update-ref', 'refs/heads/master', publicSha, previousMaster], {
    cwd: workdir,
  });
  await git(['reflog', 'expire', '--expire=now', '--all'], { cwd: workdir });
  await git(['gc', '--prune=now', '--quiet'], { cwd: workdir });

  const audit = auditPublicGitMetadata(
    await readPublicGitMetadata({ repo: workdir })
  );
  if (audit.findings.length > 0 || audit.tags !== 0) {
    fail(
      `whole-history metadata audit refused the projection ` +
        `(${audit.findings.length} finding(s), ${audit.tags} tag(s))`
    );
  }
  return { publicSha, audit };
}

export const EXISTING_PUBLIC_REF = 'refs/exawatt/existing-public';

/**
 * Brings the public remote's current tip into the projection so ancestry can
 * be decided locally. An empty remote resolves to null: there is nothing to
 * fast-forward past when the public repository has no history yet.
 */
async function fetchExistingPublicTip(workdir, { repository, ref = 'master' }) {
  if (typeof repository !== 'string' || repository.length === 0) {
    fail('fastForwardFrom.repository must be a repository path or URL');
  }
  const advertised = await git(['ls-remote', repository, ref], {
    cwd: workdir,
  });
  if (advertised.trim() === '') return null;
  await git(
    [
      'fetch',
      '--quiet',
      '--no-tags',
      repository,
      ref + ':' + EXISTING_PUBLIC_REF,
    ],
    { cwd: workdir }
  );
  return EXISTING_PUBLIC_REF;
}

function nullSeparatedPaths(value) {
  return value.toString('utf8').split('\0').filter(Boolean).sort();
}

async function materializePublicSnapshot({
  sourceRepo,
  sourceSha,
  projectionRepo,
  manifestPath,
  blobCache,
  renderedObjectCache,
}) {
  const plan = await buildProjectionPlan({
    sourceRepo,
    sourceSha,
    manifestPath,
    blobCache,
  });
  const outputs = [];

  for (const output of plan.copiedOutputs) {
    outputs.push({
      path: output.path,
      mode: output.mode,
      object: output.sourceObject,
    });
  }
  for (const output of plan.renderedOutputs) {
    const source = blobCache.get(output.sourceObject);
    if (source === undefined) {
      fail(`missing GENERATED blob ${output.sourceObject} for ${output.path}`);
    }
    const cacheKey = `${output.kind}\0${output.path}\0${output.sourceObject}`;
    let object = renderedObjectCache.get(cacheKey);
    if (!object) {
      const rendered = renderRecipeOutput({
        recipeId: output.recipe,
        kind: output.kind,
        path: output.path,
        source,
      });
      object = await hashBlob(projectionRepo, rendered);
      renderedObjectCache.set(cacheKey, object);
    }
    outputs.push({
      path: output.path,
      mode: output.mode,
      object,
    });
  }
  outputs.sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...plan,
    tree: await writeTree(projectionRepo, outputs),
    outputs,
    projectedPaths: outputs.map(output => output.path),
    renderedVariants: plan.renderedOutputs.length,
  };
}

async function readManifestState(sourceRepo, commit, manifestPath) {
  const blob = (
    await git(['rev-parse', `${commit}:${manifestPath}`], { cwd: sourceRepo })
  ).trim();
  let manifest;
  try {
    manifest = JSON.parse(
      await git(['cat-file', 'blob', blob], { cwd: sourceRepo })
    );
  } catch (error) {
    fail(`source manifest at ${commit} is invalid JSON: ${error.message}`);
  }
  validatePathManifest(manifest);
  return { blob, manifest, classify: createPathClassifier(manifest) };
}

async function applyPublicCommitChanges({
  sourceRepo,
  commit,
  changedPaths,
  outputMap,
  manifestState,
  projectionRepo,
  blobCache,
  renderedObjectCache,
}) {
  const entries = parseTreeRecords(
    await git(['ls-tree', '-rz', '--full-tree', commit], {
      cwd: sourceRepo,
      encoding: 'buffer',
    })
  );
  const tracked = new Map(entries.map(entry => [entry.path, entry]));
  const affectedRecipes = new Set();

  for (const file of changedPaths) {
    const classification = manifestState.classify(file);
    if (classification.classification === 'PUBLIC') {
      const entry = tracked.get(file);
      if (entry) {
        outputMap.set(file, {
          path: file,
          mode: entry.mode,
          object: entry.object,
        });
      } else {
        outputMap.delete(file);
      }
    } else {
      outputMap.delete(file);
    }
    if (classification.recipe) affectedRecipes.add(classification.recipe);
  }
  for (const [recipeId, recipe] of Object.entries(
    manifestState.manifest.recipes
  )) {
    if (recipe.inputs.some(input => changedPaths.includes(input))) {
      affectedRecipes.add(recipeId);
    }
  }

  let renderedVariants = 0;
  for (const recipeId of [...affectedRecipes].sort()) {
    const recipe = manifestState.manifest.recipes[recipeId];
    if (!recipe) fail(`changed path names unknown recipe ${recipeId}`);
    for (const output of recipe.outputs) {
      if (!rendersOutput(recipe.kind, output.path)) {
        outputMap.delete(output.path);
        continue;
      }
      const entry = tracked.get(output.path);
      if (!entry) {
        outputMap.delete(output.path);
        continue;
      }
      if (!recipe.inputs.includes(output.path)) {
        fail(
          `recipe ${recipeId} renders ${output.path} from that path, so it ` +
            'must declare it as an input'
        );
      }
      let source = blobCache.get(entry.object);
      if (source === undefined) {
        source = (await readBlobBatch(sourceRepo, [entry.object])).get(
          entry.object
        );
        blobCache.set(entry.object, source);
      }
      const cacheKey = `${recipe.kind}\0${output.path}\0${entry.object}`;
      let object = renderedObjectCache.get(cacheKey);
      if (!object) {
        object = await hashBlob(
          projectionRepo,
          renderRecipeOutput({
            recipeId,
            kind: recipe.kind,
            path: output.path,
            source,
          })
        );
        renderedObjectCache.set(cacheKey, object);
      }
      outputMap.set(output.path, {
        path: output.path,
        mode: output.mode,
        object,
      });
      renderedVariants += 1;
    }
  }
  return renderedVariants;
}

async function sourceCommitsAfter(sourceRepo, epochSourceSha, sourceSha) {
  const rows = (
    await git(
      [
        'rev-list',
        '--reverse',
        '--topo-order',
        '--parents',
        `${epochSourceSha}..${sourceSha}`,
      ],
      { cwd: sourceRepo }
    )
  )
    .split('\n')
    .filter(Boolean)
    .map(row => row.split(' '));
  let expectedParent = epochSourceSha;
  for (const [commit, ...parents] of rows) {
    if (parents.length !== 1 || parents[0] !== expectedParent) {
      fail(
        `continuous projection requires a linear private master after the ` +
          `epoch; ${commit} does not have ${expectedParent} as its sole parent`
      );
    }
    expectedParent = commit;
  }
  return rows.map(([commit]) => commit);
}

async function replayAfterEpoch({
  sourceRepo,
  sourceSha,
  projectionRepo,
  epoch,
  manifestPath,
  metadataProjector = projectPublicCommitMetadata,
}) {
  const commits = await sourceCommitsAfter(
    sourceRepo,
    epoch.sourceSha,
    sourceSha
  );
  let publicParent = epoch.publicSha;
  let publicTree = (
    await git(['rev-parse', `${publicParent}^{tree}`], { cwd: projectionRepo })
  ).trim();
  let previousSource = epoch.sourceSha;
  let emittedCommits = 0;
  let renderedVariants = 0;
  let tipSnapshot = null;
  const blobCache = new Map();
  const renderedObjectCache = new Map();
  let manifestState = await readManifestState(
    sourceRepo,
    epoch.sourceSha,
    manifestPath
  );
  let outputMap = new Map(
    parseTreeRecords(
      await git(['ls-tree', '-rz', '--full-tree', epoch.publicSha], {
        cwd: projectionRepo,
        encoding: 'buffer',
      })
    ).map(entry => [entry.path, entry])
  );

  // PUBLIC blobs keep their source Git object identity. Fetching the source
  // tip once makes those objects available without spawning one hash process
  // per path per commit. The private ref is removed and unreachable objects
  // are pruned before a destination is returned or any public ref is pushed.
  await git(
    [
      '-c',
      'uploadpack.allowAnySHA1InWant=true',
      'fetch',
      '--quiet',
      '--no-tags',
      path.resolve(sourceRepo),
      `${sourceSha}:refs/exawatt/source-tip`,
    ],
    { cwd: projectionRepo }
  );

  for (const commit of commits) {
    const sourcePaths = nullSeparatedPaths(
      await git(
        [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          previousSource,
          commit,
        ],
        { cwd: sourceRepo, encoding: 'buffer' }
      )
    );
    const manifestBlob = (
      await git(['rev-parse', `${commit}:${manifestPath}`], {
        cwd: sourceRepo,
      })
    ).trim();
    let nextTree;
    if (manifestBlob !== manifestState.blob) {
      manifestState = await readManifestState(sourceRepo, commit, manifestPath);
      tipSnapshot = await materializePublicSnapshot({
        sourceRepo,
        sourceSha: commit,
        projectionRepo,
        manifestPath,
        blobCache,
        renderedObjectCache,
      });
      outputMap = new Map(
        tipSnapshot.outputs.map(output => [output.path, output])
      );
      renderedVariants += tipSnapshot.renderedVariants;
      nextTree = tipSnapshot.tree;
    } else {
      renderedVariants += await applyPublicCommitChanges({
        sourceRepo,
        commit,
        changedPaths: sourcePaths,
        outputMap,
        manifestState,
        projectionRepo,
        blobCache,
        renderedObjectCache,
      });
      nextTree = await writeTree(
        projectionRepo,
        [...outputMap.values()].sort((a, b) => a.path.localeCompare(b.path))
      );
    }
    if (nextTree !== publicTree) {
      const publicPaths = nullSeparatedPaths(
        await git(
          [
            'diff-tree',
            '--no-commit-id',
            '--name-only',
            '-r',
            '-z',
            publicTree,
            nextTree,
          ],
          { cwd: projectionRepo, encoding: 'buffer' }
        )
      );
      const publicSet = new Set(publicPaths);
      const sourceMetadata = await readCommitMetadata(sourceRepo, commit);
      const metadata = await metadataProjector({
        sourceSha: commit,
        ...sourceMetadata,
        publicChange: {
          hasChanges: publicPaths.length > 0,
          paths: publicPaths,
        },
        privateChange: {
          hasChanges: sourcePaths.some(file => !publicSet.has(file)),
          paths: sourcePaths.filter(file => !publicSet.has(file)),
        },
      });
      publicParent = await createCommit(projectionRepo, {
        tree: nextTree,
        parent: publicParent,
        metadata,
      });
      publicTree = nextTree;
      emittedCommits += 1;
    }
    previousSource = commit;
  }

  if (tipSnapshot?.sourceSha !== sourceSha) {
    tipSnapshot = await materializePublicSnapshot({
      sourceRepo,
      sourceSha,
      projectionRepo,
      manifestPath,
      blobCache,
      renderedObjectCache,
    });
  }
  if (tipSnapshot.tree !== publicTree) {
    fail(
      `incremental replay produced tree ${publicTree}, but Gate A produces ` +
        `${tipSnapshot.tree} at ${sourceSha}`
    );
  }

  await git(['update-ref', 'refs/heads/master', publicParent], {
    cwd: projectionRepo,
  });
  await prunePrivateSourceObjects(projectionRepo);
  return {
    publicSha: publicParent,
    replayedSourceCommits: commits.length,
    emittedCommits,
    renderedVariants,
    tipSnapshot,
    replayPlanDigest: sha256(
      JSON.stringify({ commits, tipPlanDigest: tipSnapshot.planDigest })
    ),
  };
}

/**
 * Projects `sourceSha`'s public history into a fresh repository.
 *
 * `destination`, when given, must not already exist; the projected repository
 * is placed there with `master` checked out. filter-repo rewrites in place, so
 * the projection always runs in a scratch clone that is removed on failure and
 * when no destination is requested.
 *
 * `fastForwardFrom` is `{ repository, ref }` naming the public remote. When
 * given, the projection is refused — and the scratch clone destroyed — unless
 * the remote's current tip is an ancestor of the projected tip.
 */
async function projectLegacyPublicHistory({
  sourceRepo,
  sourceSha,
  destination = null,
  fastForwardFrom = null,
  manifestPath = OPEN_SOURCE_PATH_MANIFEST,
  sanitizeMetadata = false,
  metadataProjector = projectPublicCommitMetadata,
}) {
  const plan = await buildProjectionPlan({
    sourceRepo,
    sourceSha,
    manifestPath,
  });

  const resolvedDestination = destination ? path.resolve(destination) : null;
  if (resolvedDestination && existsSync(resolvedDestination)) {
    fail('projection destination already exists: ' + resolvedDestination);
  }
  const parent = resolvedDestination ? path.dirname(resolvedDestination) : null;
  if (parent) await mkdir(parent, { recursive: true });
  const workdir = await mkdtemp(
    path.join(parent ?? tmpdir(), 'exawatt-projection-')
  );

  try {
    await git(['init', '--quiet', '--initial-branch=master', '.'], {
      cwd: workdir,
    });
    // Fetch exactly the source commit. `uploadpack.allowAnySHA1InWant`
    // propagates to the upload-pack the local transport spawns, so an
    // arbitrary commit works without needing a branch that points at it.
    await git(
      [
        '-c',
        'uploadpack.allowAnySHA1InWant=true',
        'fetch',
        '--quiet',
        '--no-tags',
        path.resolve(sourceRepo),
        plan.sourceSha,
      ],
      { cwd: workdir }
    );
    await git(['update-ref', 'refs/heads/master', plan.sourceSha], {
      cwd: workdir,
    });
    await git(['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: workdir });

    const projectedSet = [
      ...plan.copiedPaths,
      ...plan.renderedOutputs.map(output => output.path),
    ].sort();
    const pathsFile = path.join(workdir, '.git', 'exawatt-public-paths');
    await writeFile(
      pathsFile,
      projectedSet.map(output => 'literal:' + output).join('\n') + '\n',
      'utf8'
    );
    const substitution = await prepareRenderedVariants(workdir, plan);
    await runFilterRepo(workdir, pathsFile, substitution);
    if (substitution) {
      await rm(substitution.directory, { recursive: true, force: true });
      await rm(substitution.mapPath, { force: true });
      await rm(substitution.callbackPath, { force: true });
    }
    await rm(pathsFile, { force: true });

    const sanitation = sanitizeMetadata
      ? await sanitizeLegacyProjectionMetadata({
          workdir,
          metadataProjector,
        })
      : null;

    const publicSha =
      sanitation?.publicSha ??
      (
        await git(['rev-parse', '--verify', 'refs/heads/master^{commit}'], {
          cwd: workdir,
        })
      ).trim();
    const projectedPaths = (
      await git(['ls-tree', '-rz', '--name-only', '--full-tree', publicSha], {
        cwd: workdir,
        encoding: 'buffer',
      })
    )
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .sort();

    let existingPublicSha = null;
    if (fastForwardFrom) {
      const existingRef = await fetchExistingPublicTip(
        workdir,
        fastForwardFrom
      );
      await assertFastForward({
        repo: workdir,
        candidateSha: publicSha,
        existingRef,
      });
      existingPublicSha = existingRef
        ? (
            await git(['rev-parse', '--verify', existingRef + '^{commit}'], {
              cwd: workdir,
            })
          ).trim()
        : null;
    }

    if (resolvedDestination) {
      await rename(workdir, resolvedDestination);
      await git(['checkout', '--quiet', '--force', 'master'], {
        cwd: resolvedDestination,
      });
    } else {
      await rm(workdir, { recursive: true, force: true });
    }

    return {
      publicSha,
      outputCount: projectedPaths.length,
      sourceSha: plan.sourceSha,
      planDigest: plan.planDigest,
      projectedPaths,
      generatedOutputs: plan.generatedOutputs,
      renderedOutputs: plan.renderedOutputs,
      unrenderedOutputs: plan.unrenderedOutputs,
      renderedVariants: substitution?.renderedVariants ?? 0,
      skippedRevisions: substitution?.skippedRevisions ?? 0,
      entryBoundaries: substitution?.entryBoundaries ?? [],
      metadataAudit: sanitation?.audit ?? null,
      metadataPolicyId: sanitizeMetadata ? PUBLIC_METADATA_POLICY_ID : null,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
      existingPublicSha,
      destination: resolvedDestination,
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Continuous projection freezes the already-published prefix at a verified
 * epoch and appends the exact Gate A tree of each later private commit. A
 * future source commit can therefore delete or rename a PUBLIC path without
 * changing the public commits that introduced it.
 *
 * Repositories without an epoch (public clones and isolated fixtures) rebuild
 * the complete surviving history with public-safe metadata. Tests can pass an
 * explicit epoch to prove the forward-replay contract without committing
 * fixture-specific policy.
 */
async function projectFromPublishedAnchor({
  sourceRepo,
  sourceSha,
  destination,
  fastForwardFrom,
  manifestPath,
  anchor,
  metadataProjector,
  verifySnapshotAnchor = false,
}) {
  if (!fastForwardFrom) {
    fail('resumeFrom requires fastForwardFrom to verify the public prefix');
  }
  const isSourceAncestor = await git(
    ['merge-base', '--is-ancestor', anchor.sourceSha, sourceSha],
    { cwd: sourceRepo }
  ).then(
    () => true,
    () => false
  );
  if (!isSourceAncestor) {
    fail(
      `resume source ${anchor.sourceSha} is not an ancestor of ${sourceSha}`
    );
  }

  const resolvedDestination = destination ? path.resolve(destination) : null;
  if (resolvedDestination && existsSync(resolvedDestination)) {
    fail('projection destination already exists: ' + resolvedDestination);
  }
  const container = await mkdtemp(
    path.join(
      resolvedDestination ? path.dirname(resolvedDestination) : tmpdir(),
      'exawatt-resumed-projection-'
    )
  );
  const projectionRepo = path.join(container, 'public');
  try {
    await mkdir(projectionRepo);
    await git(['init', '--quiet', '--initial-branch=master', '.'], {
      cwd: projectionRepo,
    });
    const existingRef = await fetchExistingPublicTip(
      projectionRepo,
      fastForwardFrom
    );
    if (!existingRef) fail('resumeFrom cannot verify an empty public remote');
    const existingPublicSha = (
      await git(['rev-parse', `${existingRef}^{commit}`], {
        cwd: projectionRepo,
      })
    ).trim();
    if (!verifySnapshotAnchor && existingPublicSha !== anchor.publicSha) {
      fail(
        `source lock expects public ${anchor.publicSha}, but the remote is ` +
          existingPublicSha
      );
    }
    if (verifySnapshotAnchor) {
      await git(
        ['merge-base', '--is-ancestor', anchor.publicSha, existingPublicSha],
        { cwd: projectionRepo }
      ).catch(() => {
        fail(
          'published snapshot anchor is not an ancestor of the observed public tip'
        );
      });
      const state = await readManifestState(
        sourceRepo,
        sourceSha,
        manifestPath
      );
      if (
        !['PRIVATE', 'EXCLUDED'].includes(
          state.classify(PUBLIC_PROJECTION_EPOCH_PATH).classification
        )
      ) {
        fail('the published snapshot epoch must remain private or excluded');
      }
      await fetchPrivateSourceObjects(
        sourceRepo,
        anchor.sourceSha,
        projectionRepo
      );
      const snapshot = await materializePublicSnapshot({
        sourceRepo,
        sourceSha: anchor.sourceSha,
        projectionRepo,
        manifestPath,
        blobCache: new Map(),
        renderedObjectCache: new Map(),
      });
      assertCompleteSnapshot(snapshot);
      const anchorTree = (
        await git(['rev-parse', `${anchor.publicSha}^{tree}`], {
          cwd: projectionRepo,
        })
      ).trim();
      if (snapshot.tree !== anchorTree)
        fail(
          'published snapshot anchor tree does not match its declared private source'
        );
    }
    await git(['update-ref', 'refs/heads/master', anchor.publicSha], {
      cwd: projectionRepo,
    });
    await git(['symbolic-ref', 'HEAD', 'refs/heads/master'], {
      cwd: projectionRepo,
    });

    const replay = await replayAfterEpoch({
      sourceRepo,
      sourceSha,
      projectionRepo,
      epoch: anchor,
      manifestPath,
      metadataProjector,
    });
    await assertFastForward({
      repo: projectionRepo,
      candidateSha: replay.publicSha,
      existingRef,
    });
    const projectedPaths = nullSeparatedPaths(
      await git(
        ['ls-tree', '-rz', '--name-only', '--full-tree', replay.publicSha],
        { cwd: projectionRepo, encoding: 'buffer' }
      )
    );
    if (resolvedDestination) {
      await rename(projectionRepo, resolvedDestination);
      await git(['checkout', '--quiet', '--force', 'master'], {
        cwd: resolvedDestination,
      });
    }
    const tip = replay.tipSnapshot;
    const result = {
      publicSha: replay.publicSha,
      outputCount: projectedPaths.length,
      sourceSha,
      planDigest: sha256(
        JSON.stringify({
          resumedPublicSha: anchor.publicSha,
          replayPlanDigest: replay.replayPlanDigest,
        })
      ),
      projectedPaths,
      generatedOutputs: tip.generatedOutputs,
      renderedOutputs: tip.renderedOutputs,
      unrenderedOutputs: tip.unrenderedOutputs,
      renderedVariants: replay.renderedVariants,
      skippedRevisions: 0,
      entryBoundaries: [],
      metadataAudit: null,
      metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
      existingPublicSha,
      destination: resolvedDestination,
      epoch: anchor,
      replayedSourceCommits: replay.replayedSourceCommits,
      emittedCommits: replay.emittedCommits,
      rebuiltHistory: false,
      resumedFrom: anchor,
    };
    if (!resolvedDestination) {
      await rm(container, { recursive: true, force: true });
    }
    return result;
  } catch (error) {
    await rm(container, { recursive: true, force: true });
    throw error;
  }
}

export async function projectPublicHistory({
  sourceRepo,
  sourceSha,
  destination = null,
  fastForwardFrom = null,
  manifestPath = OPEN_SOURCE_PATH_MANIFEST,
  epoch: explicitEpoch = undefined,
  metadataProjector = projectPublicCommitMetadata,
  rebuildHistory = false,
  resumeFrom = null,
}) {
  const resolvedSourceRepo = path.resolve(sourceRepo);
  const resolvedSourceSha = (
    await git(['rev-parse', '--verify', `${sourceSha}^{commit}`], {
      cwd: resolvedSourceRepo,
    })
  ).trim();
  const epoch =
    explicitEpoch === undefined
      ? await readProjectionEpoch(resolvedSourceRepo)
      : explicitEpoch === null
        ? null
        : validateProjectionEpoch(explicitEpoch);
  if (rebuildHistory) {
    const rebuilt = await projectLegacyPublicHistory({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      destination,
      fastForwardFrom,
      manifestPath,
      sanitizeMetadata: true,
      metadataProjector,
    });
    return {
      ...rebuilt,
      epoch: null,
      replayedSourceCommits: 0,
      emittedCommits: 0,
      rebuiltHistory: true,
      metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
    };
  }
  if (resumeFrom) {
    const currentContract =
      resumeFrom.metadataPolicyId === PUBLIC_METADATA_POLICY_ID &&
      resumeFrom.projectionContractId === PUBLIC_PROJECTION_CONTRACT_ID;
    const recordedLegacyEpoch =
      !resumeFrom.metadataPolicyId &&
      !resumeFrom.projectionContractId &&
      epoch &&
      !epoch.metadataPolicyId &&
      !epoch.projectionContractId &&
      resumeFrom.privateSha === epoch.sourceSha &&
      resumeFrom.publicSha === epoch.publicSha;
    if (!currentContract && !recordedLegacyEpoch) {
      fail(
        'resumeFrom does not carry the current metadata/projection contract ' +
          'and is not the exact recorded legacy epoch; reviewed reseed required'
      );
    }
    const anchor = validateProjectionEpoch({
      schemaVersion: 1,
      sourceSha: resumeFrom.privateSha,
      publicSha: resumeFrom.publicSha,
      reason: 'Verified source-lock publication pair used as replay anchor',
      ...(resumeFrom.metadataPolicyId
        ? { metadataPolicyId: resumeFrom.metadataPolicyId }
        : {}),
      ...(resumeFrom.projectionContractId
        ? { projectionContractId: resumeFrom.projectionContractId }
        : {}),
    });
    return projectFromPublishedAnchor({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      destination,
      fastForwardFrom,
      manifestPath,
      anchor,
      metadataProjector,
    });
  }
  if (
    epoch?.metadataPolicyId &&
    epoch.metadataPolicyId !== PUBLIC_METADATA_POLICY_ID
  ) {
    fail(
      `epoch metadata policy ${epoch.metadataPolicyId} is unsupported; ` +
        `expected ${PUBLIC_METADATA_POLICY_ID}`
    );
  }
  if (
    epoch?.projectionContractId &&
    epoch.projectionContractId !== PUBLIC_PROJECTION_CONTRACT_ID
  ) {
    fail(
      `epoch projection contract ${epoch.projectionContractId} is unsupported; ` +
        `expected ${PUBLIC_PROJECTION_CONTRACT_ID}`
    );
  }

  if (epoch?.mode === 'published-snapshot') {
    return projectFromPublishedAnchor({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      destination,
      fastForwardFrom,
      manifestPath,
      anchor: epoch,
      metadataProjector,
      verifySnapshotAnchor: true,
    });
  }

  let usesEpoch = false;
  if (epoch) {
    usesEpoch = await git(
      ['merge-base', '--is-ancestor', epoch.sourceSha, resolvedSourceSha],
      { cwd: resolvedSourceRepo }
    ).then(
      () => true,
      () => false
    );
  }
  if (!usesEpoch || epoch.sourceSha === resolvedSourceSha) {
    const legacy = await projectLegacyPublicHistory({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      destination,
      fastForwardFrom,
      manifestPath,
      // No public prefix exists to preserve when there is no usable epoch.
      // First seeds and deliberate rebuilds therefore sanitize by default.
      // The sole legacy-metadata exception is reconstructing the exact frozen
      // epoch already published before metadata policy v2 existed.
      sanitizeMetadata:
        !usesEpoch || epoch?.metadataPolicyId === PUBLIC_METADATA_POLICY_ID,
      metadataProjector,
    });
    if (usesEpoch && legacy.publicSha !== epoch.publicSha) {
      fail(
        `the frozen epoch ${epoch.sourceSha} now projects to ` +
          `${legacy.publicSha}, not recorded ${epoch.publicSha}; existing ` +
          'renderer semantics changed and must be restored or deliberately reseeded'
      );
    }
    return {
      ...legacy,
      epoch: usesEpoch ? epoch : null,
      replayedSourceCommits: 0,
      emittedCommits: 0,
    };
  }

  const resolvedDestination = destination ? path.resolve(destination) : null;
  if (resolvedDestination && existsSync(resolvedDestination)) {
    fail('projection destination already exists: ' + resolvedDestination);
  }
  const container = await mkdtemp(
    path.join(
      resolvedDestination ? path.dirname(resolvedDestination) : tmpdir(),
      'exawatt-continuous-projection-'
    )
  );
  const projectionRepo = path.join(container, 'public');
  try {
    const prefix = await projectLegacyPublicHistory({
      sourceRepo: resolvedSourceRepo,
      sourceSha: epoch.sourceSha,
      destination: projectionRepo,
      manifestPath,
      sanitizeMetadata: epoch.metadataPolicyId === PUBLIC_METADATA_POLICY_ID,
      metadataProjector,
    });
    if (prefix.publicSha !== epoch.publicSha) {
      fail(
        `the frozen epoch ${epoch.sourceSha} projects to ${prefix.publicSha}, ` +
          `not recorded ${epoch.publicSha}; existing renderer semantics ` +
          'changed and must be restored or deliberately reseeded'
      );
    }

    const replay = await replayAfterEpoch({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      projectionRepo,
      epoch,
      manifestPath,
      metadataProjector,
    });
    const publicSha = replay.publicSha;
    const projectedPaths = nullSeparatedPaths(
      await git(['ls-tree', '-rz', '--name-only', '--full-tree', publicSha], {
        cwd: projectionRepo,
        encoding: 'buffer',
      })
    );

    let existingPublicSha = null;
    if (fastForwardFrom) {
      const existingRef = await fetchExistingPublicTip(
        projectionRepo,
        fastForwardFrom
      );
      await assertFastForward({
        repo: projectionRepo,
        candidateSha: publicSha,
        existingRef,
      });
      existingPublicSha = existingRef
        ? (
            await git(['rev-parse', `${existingRef}^{commit}`], {
              cwd: projectionRepo,
            })
          ).trim()
        : null;
    }

    if (resolvedDestination) {
      await rename(projectionRepo, resolvedDestination);
      await git(['checkout', '--quiet', '--force', 'master'], {
        cwd: resolvedDestination,
      });
    }
    const tip = replay.tipSnapshot;
    return {
      publicSha,
      outputCount: projectedPaths.length,
      sourceSha: resolvedSourceSha,
      planDigest: sha256(
        JSON.stringify({
          epochPlanDigest: prefix.planDigest,
          replayPlanDigest: replay.replayPlanDigest,
        })
      ),
      projectedPaths,
      generatedOutputs: tip?.generatedOutputs ?? prefix.generatedOutputs,
      renderedOutputs: tip?.renderedOutputs ?? prefix.renderedOutputs,
      unrenderedOutputs: tip?.unrenderedOutputs ?? prefix.unrenderedOutputs,
      renderedVariants: prefix.renderedVariants + replay.renderedVariants,
      skippedRevisions: prefix.skippedRevisions,
      entryBoundaries: prefix.entryBoundaries,
      existingPublicSha,
      destination: resolvedDestination,
      epoch,
      replayedSourceCommits: replay.replayedSourceCommits,
      emittedCommits: replay.emittedCommits,
      metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
    };
  } catch (error) {
    if (resolvedDestination && existsSync(resolvedDestination)) {
      await rm(resolvedDestination, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

async function fetchPrivateSourceObjects(
  sourceRepo,
  sourceSha,
  projectionRepo
) {
  await git(
    [
      'fetch',
      '--quiet',
      '--no-tags',
      path.resolve(sourceRepo),
      `${sourceSha}:refs/exawatt/source-tip`,
    ],
    { cwd: projectionRepo }
  );
}

async function prunePrivateSourceObjects(projectionRepo) {
  await git(['update-ref', '-d', 'refs/exawatt/source-tip'], {
    cwd: projectionRepo,
  });
  await rm(path.join(projectionRepo, '.git', 'FETCH_HEAD'), { force: true });
  await git(['reflog', 'expire', '--expire=now', '--all'], {
    cwd: projectionRepo,
  });
  await git(['gc', '--prune=now', '--quiet'], { cwd: projectionRepo });
}

function assertCompleteSnapshot(snapshot) {
  if (snapshot.unrenderedOutputs.length > 0) {
    fail(
      'current public snapshot has unrendered outputs; no catch-up candidate was prepared'
    );
  }
}

/**
 * Operator-reviewed catch-up: append today's complete Gate A snapshot to the
 * exact existing public prefix. Never replays unpublished revisions, rewrites
 * an existing commit, certifies a build, or pushes. Old public metadata stays
 * reachable; this repairs synchronization, not historical metadata erasure.
 */
export async function projectPublicCatchup({
  sourceRepo,
  sourceSha,
  destination = null,
  fastForwardFrom,
  expectedPublicSha,
  manifestPath = OPEN_SOURCE_PATH_MANIFEST,
}) {
  if (!/^[0-9a-f]{40}$/u.test(expectedPublicSha ?? '') || !fastForwardFrom) {
    fail(
      'catch-up requires an exact expected public SHA and public repository'
    );
  }
  const resolvedSourceRepo = path.resolve(sourceRepo);
  const resolvedSourceSha = (
    await git(['rev-parse', '--verify', `${sourceSha}^{commit}`], {
      cwd: resolvedSourceRepo,
    })
  ).trim();
  const resolvedDestination = destination ? path.resolve(destination) : null;
  if (resolvedDestination && existsSync(resolvedDestination))
    fail('projection destination already exists: ' + resolvedDestination);
  const container = await mkdtemp(
    path.join(
      resolvedDestination ? path.dirname(resolvedDestination) : tmpdir(),
      'exawatt-public-catchup-'
    )
  );
  const projectionRepo = path.join(container, 'public');
  try {
    await mkdir(projectionRepo);
    await git(['init', '--quiet', '--initial-branch=master', '.'], {
      cwd: projectionRepo,
    });
    const existingRef = await fetchExistingPublicTip(
      projectionRepo,
      fastForwardFrom
    );
    if (!existingRef) fail('catch-up requires an existing public prefix');
    const observed = (
      await git(['rev-parse', `${existingRef}^{commit}`], {
        cwd: projectionRepo,
      })
    ).trim();
    if (observed !== expectedPublicSha)
      fail(
        `catch-up expected public ${expectedPublicSha}, observed ${observed}`
      );
    const state = await readManifestState(
      resolvedSourceRepo,
      resolvedSourceSha,
      manifestPath
    );
    if (
      !['PRIVATE', 'EXCLUDED'].includes(
        state.classify(PUBLIC_PROJECTION_EPOCH_PATH).classification
      )
    ) {
      fail('the catch-up epoch must remain private or excluded');
    }
    await fetchPrivateSourceObjects(
      resolvedSourceRepo,
      resolvedSourceSha,
      projectionRepo
    );
    const snapshot = await materializePublicSnapshot({
      sourceRepo: resolvedSourceRepo,
      sourceSha: resolvedSourceSha,
      projectionRepo,
      manifestPath,
      blobCache: new Map(),
      renderedObjectCache: new Map(),
    });
    assertCompleteSnapshot(snapshot);
    const previousTree = (
      await git(['rev-parse', `${expectedPublicSha}^{tree}`], {
        cwd: projectionRepo,
      })
    ).trim();
    const publicPaths = nullSeparatedPaths(
      await git(
        [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          previousTree,
          snapshot.tree,
        ],
        { cwd: projectionRepo, encoding: 'buffer' }
      )
    );
    let publicSha = expectedPublicSha;
    if (snapshot.tree !== previousTree) {
      const sourceMetadata = await readCommitMetadata(
        resolvedSourceRepo,
        resolvedSourceSha
      );
      const metadata = await projectPublicCommitMetadata({
        sourceSha: resolvedSourceSha,
        ...sourceMetadata,
        publicChange: { hasChanges: true, paths: publicPaths },
        // Catch-up spans unpublished private history: source prose is never a
        // reviewed public message even when the last commit changed one file.
        privateChange: { hasChanges: true, paths: [] },
      });
      publicSha = await createCommit(projectionRepo, {
        tree: snapshot.tree,
        parent: expectedPublicSha,
        metadata,
      });
    }
    await git(['update-ref', 'refs/heads/master', publicSha], {
      cwd: projectionRepo,
    });
    await prunePrivateSourceObjects(projectionRepo);
    await assertFastForward({
      repo: projectionRepo,
      candidateSha: publicSha,
      existingRef,
    });
    if (resolvedDestination) {
      await rename(projectionRepo, resolvedDestination);
      await git(['checkout', '--quiet', '--force', 'master'], {
        cwd: resolvedDestination,
      });
    }
    const epochUpdate = {
      schemaVersion: 1,
      mode: 'published-snapshot',
      sourceSha: resolvedSourceSha,
      publicSha,
      metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
      reason:
        'Reviewed current snapshot appended to the existing public prefix; unpublished intermediate revisions were not replayed',
    };
    return {
      publicSha,
      sourceSha: resolvedSourceSha,
      existingPublicSha: expectedPublicSha,
      outputCount: snapshot.projectedPaths.length,
      planDigest: sha256(
        JSON.stringify({
          catchupFrom: expectedPublicSha,
          snapshotPlanDigest: snapshot.planDigest,
        })
      ),
      projectedPaths: snapshot.projectedPaths,
      generatedOutputs: snapshot.generatedOutputs,
      renderedOutputs: snapshot.renderedOutputs,
      unrenderedOutputs: snapshot.unrenderedOutputs,
      renderedVariants: snapshot.renderedVariants,
      skippedRevisions: 0,
      entryBoundaries: [],
      metadataAudit: null,
      metadataPolicyId: PUBLIC_METADATA_POLICY_ID,
      projectionContractId: PUBLIC_PROJECTION_CONTRACT_ID,
      destination: resolvedDestination,
      epoch: epochUpdate,
      epochUpdate,
      replayedSourceCommits: 0,
      emittedCommits: publicSha === expectedPublicSha ? 0 : 1,
      rebuiltHistory: false,
      snapshotCatchup: true,
    };
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}
