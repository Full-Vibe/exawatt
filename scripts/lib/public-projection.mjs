import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  buildSeedPlan,
  validatePathManifest,
} from './open-source-paths.mjs';
import {
  renderRecipeOutput,
  rendersOutput,
  unrenderedReason,
} from './recipe-renderers.mjs';

const execFileAsync = promisify(execFile);

export const GIT_FILTER_REPO = 'git-filter-repo';

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
 * where its recipe did, and `unrenderableRevisions` counts them. The reverse
 * is refused outright: once a revision renders, every later revision must,
 * because a newer one that stopped rendering would freeze a stale public file.
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
  const blobs = await readBlobBatch(
    sourceRepo,
    trackedEntries.map(entry => entry.object)
  );
  const plan = await buildSeedPlan({
    manifest,
    source: { commit, tree, manifestPath, manifestBlob },
    trackedEntries,
    readBlob: async object => blobs.get(object),
  });

  const copiedPaths = plan.outputs
    .filter(output => output.recipe === null)
    .map(output => output.path)
    .sort();
  const generatedOutputs = plan.outputs
    .filter(output => output.recipe !== null)
    .map(output => ({
      path: output.path,
      mode: output.mode,
      recipe: output.recipe,
      kind: manifest.recipes[output.recipe].kind,
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
 * the private blob reach the public repository. A revision this module could
 * not render — one predating its recipe's directives — is dropped from that
 * commit, which is what makes the path enter public history where its recipe
 * became executable instead of before it.
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
 * Renders every GENERATED variant the projected history will need, once per
 * distinct (path, source blob), and writes the lookup the callback reads.
 *
 * Rendering here rather than inside filter-repo is what keeps the renderers in
 * JavaScript next to the manifest that declares them, and it makes the render
 * set explicit: if a source blob at a rendered path is not in this map, the
 * callback aborts instead of guessing.
 */
async function prepareRenderedVariants(workdir, plan) {
  if (plan.renderedOutputs.length === 0) return null;
  // Reverse topological order puts every ancestor before its descendants,
  // which is what makes the "renderable from here on" check below sound.
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
    history.get(output.path).push(object);
  }

  const blobs = await readBlobBatch(workdir, [
    ...new Set([...history.values()].flat()),
  ]);
  const directory = path.join(workdir, '.git', 'exawatt-rendered');
  await mkdir(directory, { recursive: true });
  const map = { modes: {}, blobs: {}, dropped: {} };
  let renderedVariants = 0;
  let unrenderableRevisions = 0;

  for (const output of plan.renderedOutputs) {
    map.modes[output.path] = output.mode;
    // A recipe becomes executable at a commit: older revisions of the same
    // path predate the directives that declare their public variant, and
    // rendering them would either publish private bytes or guess. Those
    // revisions are dropped, exactly as the whole path was dropped before
    // this recipe had a renderer, and the path simply enters public history
    // where its recipe did.
    //
    // What must never happen is the reverse — a NEW revision that stops
    // rendering — because that would silently freeze or stale the public
    // file. Walking in ancestor-first order, the moment a revision renders,
    // every later one must too.
    let firstRendered = null;
    let failure = null;
    for (const object of history.get(output.path)) {
      const source = blobs.get(object);
      if (source === undefined) fail('missing source blob ' + object);
      const key = output.path + '\0' + sha256(source);
      if (map.blobs[key]) {
        firstRendered ??= object;
        continue;
      }
      if (map.dropped[key]) continue;
      let variant;
      try {
        variant = renderRecipeOutput({
          recipeId: output.recipe,
          kind: output.kind,
          path: output.path,
          source,
        });
      } catch (error) {
        if (firstRendered !== null) {
          fail(
            'recipe ' +
              output.recipe +
              ' rendered ' +
              output.path +
              ' at an earlier commit but not at ' +
              object +
              ', which would publish a stale public variant: ' +
              error.message
          );
        }
        map.dropped[key] = true;
        unrenderableRevisions += 1;
        failure = error;
        continue;
      }
      const file = path.join(directory, sha256(key));
      await writeFile(file, variant);
      map.blobs[key] = file;
      renderedVariants += 1;
      firstRendered ??= object;
    }
    if (firstRendered === null) {
      fail(
        'recipe ' +
          output.recipe +
          ' renders no revision of ' +
          output.path +
          ', so the public repository would never receive it: ' +
          (failure?.message ?? 'the path is absent from the projected history')
      );
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
    unrenderableRevisions,
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
export async function projectPublicHistory({
  sourceRepo,
  sourceSha,
  destination = null,
  fastForwardFrom = null,
  manifestPath = OPEN_SOURCE_PATH_MANIFEST,
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

    const publicSha = (
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
      unrenderableRevisions: substitution?.unrenderableRevisions ?? 0,
      existingPublicSha,
      destination: resolvedDestination,
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
