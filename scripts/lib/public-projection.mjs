import { execFile, spawn } from 'node:child_process';
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
 * GENERATED outputs are deliberately NOT projected yet. Gate A classifies 45
 * paths (`package.json`, `README.md`, `src/lib/auth/admin.ts`, …) GENERATED:
 * the public repository must receive a recipe's rendered bytes, never the
 * private source blob. Projecting their private blobs would leak, so this
 * module excludes them and reports them in `generatedOutputs` instead of
 * failing closed on a path it cannot render.
 *
 * Those bytes come from the seed materializer (`materializeSeedPlan`, WP6-A).
 * Seven of the eight recipes are NOT executable functions of their input
 * blobs — `materializeSeedPlan` reads them from a reviewed `--generated-tree`
 * a human produced — so they cannot be substituted per-blob across history
 * today. That matters for more than convenience: the only ancestor-stable
 * form of substitution is a `--blob-callback` that is a pure function of the
 * source blob, because a post-projection overlay commit re-parents on every
 * run and breaks the fast-forward property above. So GENERATED substitution
 * waits on recipes becoming executable; until then a projection is the PUBLIC
 * subset, and the seed supplies the generated tree separately.
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
    .map(output => ({ path: output.path, recipe: output.recipe }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (copiedPaths.length === 0) fail('Gate A projects no PUBLIC path');
  for (const output of copiedPaths) {
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

async function runFilterRepo(workdir, pathsFile) {
  try {
    await execFileAsync(
      GIT_FILTER_REPO,
      ['--force', '--quiet', '--paths-from-file', pathsFile],
      { cwd: workdir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
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

    const pathsFile = path.join(workdir, '.git', 'exawatt-public-paths');
    await writeFile(
      pathsFile,
      plan.copiedPaths.map(output => 'literal:' + output).join('\n') + '\n',
      'utf8'
    );
    await runFilterRepo(workdir, pathsFile);

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
      existingPublicSha,
      destination: resolvedDestination,
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
