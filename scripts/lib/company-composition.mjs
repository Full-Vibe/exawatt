import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  normalizeRepositoryPath,
  validatePathManifest,
  validateTrackedPathCoverage,
} from './open-source-paths.mjs';

const execFileAsync = promisify(execFile);

/**
 * The company overlay: how an official Exawatt build is composed (ENG-030 WP3,
 * decision `0036` §6).
 *
 * The public tree carries contracts and absence states. Every hosted
 * implementation lives under `company/overlay/<profile-root>/`, mirroring the
 * repository path it takes in a composed tree, and `company/overlay-manifest.json`
 * declares each one. A composition is therefore a PURE FUNCTION of
 * (public tree at a commit, overlay files at a commit) — never a hand-maintained
 * private fork, which is the shape `0036` rejected.
 *
 * Three properties this module exists to hold:
 *
 *   1. ADD-ONLY. An overlay entry may only create a path the public tree does
 *      not have. It can never replace or shadow public bytes, so an official
 *      build is the public application PLUS company code, and the difference is
 *      exactly the manifest. `assertAddOnlyTargets` enforces it case-insensitively
 *      and across directory/symlink relationships, not just exact strings.
 *   2. DISJOINT PROFILES. `official-web` takes hosted routes and services;
 *      `official-desktop` takes signing and branding. A hosted-web target can
 *      never enter a desktop composition, so a DMG cannot ship server code.
 *   3. LOUD. Every failure mode here — a missing overlay source, a target the
 *      public tree already owns, an undeclared overlay file, an unknown profile
 *      — throws. Incident `0017` is the reason: a composition that quietly
 *      degrades to "community" is how `www.exawatt.ai` served an empty
 *      leaderboard for eighteen hours.
 */

export const COMPANY_OVERLAY_MANIFEST = 'company/overlay-manifest.json';
export const COMPANY_OVERLAY_ROOT = 'company/overlay';
export const COMPANY_COMPOSITION_RECORD = '.company-composition.json';
export const COMPANY_COMPOSITION_STATE =
  '.exawatt-build/company-composition.json';

/** A composition that adds nothing. The public tree's only composition. */
export const COMMUNITY_COMPOSITION_PROFILE = 'community';

export const COMPANY_COMPOSITION_PROFILES = Object.freeze([
  'official-web',
  'official-desktop',
]);

export const COMPOSITION_PROFILES = Object.freeze([
  COMMUNITY_COMPOSITION_PROFILE,
  ...COMPANY_COMPOSITION_PROFILES,
]);

const PROFILE_OUTPUT_NAMES = Object.freeze({
  'official-web': 'web',
  'official-desktop': 'desktop',
});

const PROFILE_ROLES = Object.freeze({
  'official-web': new Set([
    'hosted-route',
    'hosted-service',
    'admin-identity',
    'invite',
    'site-asset',
  ]),
  'official-desktop': new Set([
    'official-brand',
    'official-distribution',
    'official-release',
  ]),
});

const PROFILE_SOURCE_ROOTS = Object.freeze({
  'official-web': `${COMPANY_OVERLAY_ROOT}/web/`,
  'official-desktop': `${COMPANY_OVERLAY_ROOT}/desktop/`,
});

/**
 * Targets a desktop composition may never take. A packaged application that
 * carried a hosted route would put company server code inside a signed DMG and
 * inside every user's update download.
 */
const HOSTED_WEB_TARGET_PREFIXES = Object.freeze([
  'src/app/admin/',
  'src/app/api/',
  'src/app/download/',
  'src/lib/auth/',
  'src/lib/invites/',
]);

function fail(message) {
  throw new Error(`[company-composition] ${message}`);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

function assertCompanyProfile(profile, label = 'profile') {
  if (!COMPANY_COMPOSITION_PROFILES.includes(profile)) {
    fail(`${label} must be one of ${COMPANY_COMPOSITION_PROFILES.join(', ')}`);
  }
}

export function assertCompositionProfile(profile, label = 'profile') {
  if (!COMPOSITION_PROFILES.includes(profile)) {
    fail(`${label} must be one of ${COMPOSITION_PROFILES.join(', ')}`);
  }
  return profile;
}

function lowerPath(value) {
  return value.toLocaleLowerCase('en-US');
}

function assertNoPathRelationship(first, second, label) {
  const a = lowerPath(first);
  const b = lowerPath(second);
  if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
    fail(`${label} collide: ${first} and ${second}`);
  }
}

function assertComposedTarget(target, label) {
  normalizeRepositoryPath(target, label);
  if (target.split('/').includes('.')) {
    fail(`${label} must not contain dot path segments: ${target}`);
  }
  if (
    target === '.git' ||
    target.startsWith('.git/') ||
    target === '.company-build' ||
    target.startsWith('.company-build/') ||
    target === '.exawatt-build' ||
    target.startsWith('.exawatt-build/') ||
    target === 'company' ||
    target.startsWith('company/') ||
    target === COMPANY_COMPOSITION_RECORD
  ) {
    fail(`${label} uses a reserved private or build path: ${target}`);
  }
}

function isHostedWebTarget(target) {
  return (
    HOSTED_WEB_TARGET_PREFIXES.some(prefix => target.startsWith(prefix)) ||
    target.startsWith('src/lib/goal-visuals/server.')
  );
}

export function validateCompanyOverlayManifest(manifest) {
  assertObject(manifest, 'manifest');
  assertExactKeys(manifest, ['schemaVersion', 'entries'], 'manifest');
  if (manifest.schemaVersion !== 1) {
    fail('manifest.schemaVersion must be 1');
  }
  if (!Array.isArray(manifest.entries)) {
    fail('manifest.entries must be an array');
  }

  const sources = [];
  const targets = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `manifest.entries[${index}]`;
    assertObject(entry, label);
    assertExactKeys(
      entry,
      ['source', 'target', 'role', 'profile', 'mode'],
      label
    );
    normalizeRepositoryPath(entry.source, `${label}.source`);
    if (entry.source.split('/').includes('.')) {
      fail(
        `${label}.source must not contain dot path segments: ${entry.source}`
      );
    }
    assertComposedTarget(entry.target, `${label}.target`);
    assertCompanyProfile(entry.profile, `${label}.profile`);
    if (entry.mode !== 'add') {
      fail(`${label}.mode must be add`);
    }
    if (!entry.source.startsWith(PROFILE_SOURCE_ROOTS[entry.profile])) {
      fail(
        `${label}.source must live under ${PROFILE_SOURCE_ROOTS[entry.profile]}`
      );
    }
    if (!PROFILE_ROLES[entry.profile].has(entry.role)) {
      fail(
        `${label}.role ${String(entry.role)} is not valid for ${entry.profile}`
      );
    }
    if (
      entry.profile === 'official-desktop' &&
      isHostedWebTarget(entry.target)
    ) {
      fail(
        `${label}.target is hosted-web code and cannot enter official-desktop`
      );
    }

    for (const source of sources) {
      assertNoPathRelationship(source, entry.source, 'overlay sources');
    }
    for (const target of targets) {
      assertNoPathRelationship(target, entry.target, 'overlay targets');
    }
    sources.push(entry.source);
    targets.push(entry.target);
  }

  return manifest;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function git(repo, args, { encoding = 'utf8' } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repo,
      encoding,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim();
    return fail(`git ${args[0]} failed in ${repo}: ${detail}`);
  }
}

function parseGitTree(buffer, label) {
  const entries = [];
  const paths = new Set();
  for (const record of buffer.toString('utf8').split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator === -1) fail(`malformed ${label} tree record`);
    const [mode, type, object] = record.slice(0, separator).split(' ');
    const filePath = record.slice(separator + 1);
    normalizeRepositoryPath(filePath, `${label} tracked path`);
    if (paths.has(lowerPath(filePath))) {
      fail(`${label} contains a case-insensitive path collision: ${filePath}`);
    }
    paths.add(lowerPath(filePath));
    if (type !== 'blob') {
      fail(`${label} contains unsupported Git object ${type} at ${filePath}`);
    }
    entries.push({ path: filePath, mode, object });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function readGitBlob(repo, object) {
  return git(repo, ['cat-file', 'blob', object], { encoding: 'buffer' });
}

/**
 * Reads the repository at `ref` and splits it by Gate A classification.
 *
 * Gate A (`scripts/open-source-paths.manifest.json`, read AT `ref` so a
 * composition never mixes one commit's tree with another's classifier) is the
 * only opinion about what is public. PUBLIC and GENERATED paths are the
 * composition base; PRIVATE and EXCLUDED paths never enter any composed tree
 * and come back only where the overlay declares them.
 */
export async function resolveCompositionSource(repo, ref = 'HEAD') {
  const root = path.resolve(repo);
  const commit = (
    await git(root, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ])
  ).trim();
  const tree = (await git(root, ['rev-parse', `${commit}^{tree}`])).trim();
  const records = await git(root, ['ls-tree', '-rz', '--full-tree', commit], {
    encoding: 'buffer',
  });
  const entries = parseGitTree(records, 'source');

  const manifestBlob = (
    await git(root, ['rev-parse', `${commit}:${OPEN_SOURCE_PATH_MANIFEST}`])
  ).trim();
  let manifest;
  try {
    manifest = JSON.parse(
      (await readGitBlob(root, manifestBlob)).toString('utf8')
    );
  } catch (error) {
    fail(
      `${OPEN_SOURCE_PATH_MANIFEST} at ${commit} is invalid: ${error.message}`
    );
  }
  validatePathManifest(manifest);
  const classified = validateTrackedPathCoverage(manifest, entries);

  const base = classified.filter(entry =>
    ['PUBLIC', 'GENERATED'].includes(entry.classification)
  );
  return {
    repo: root,
    commit,
    tree,
    entries,
    classified,
    basePaths: base.map(entry => entry.path).sort(),
    withheldPaths: classified
      .filter(entry => !['PUBLIC', 'GENERATED'].includes(entry.classification))
      .map(entry => entry.path)
      .sort(),
    pathManifest: { path: OPEN_SOURCE_PATH_MANIFEST, object: manifestBlob },
  };
}

async function assertCleanRepository(repo, label) {
  const status = await git(repo, [
    'status',
    '--porcelain=v1',
    '--untracked-files=normal',
    '--',
    ':(exclude).company-build',
  ]);
  if (status.length > 0) {
    const first = status.trimEnd().split('\n')[0];
    fail(`${label} repository must be clean; first change: ${first}`);
  }
}

export async function readCompanyOverlayManifestAt(source) {
  let manifestObject;
  try {
    manifestObject = (
      await git(source.repo, [
        'rev-parse',
        `${source.commit}:${COMPANY_OVERLAY_MANIFEST}`,
      ])
    ).trim();
  } catch {
    return fail(`${COMPANY_OVERLAY_MANIFEST} is absent from ${source.commit}`);
  }
  const bytes = await readGitBlob(source.repo, manifestObject);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`${COMPANY_OVERLAY_MANIFEST} is invalid JSON: ${error.message}`);
  }
  validateCompanyOverlayManifest(manifest);
  return { manifest, object: manifestObject, sha256: sha256(bytes) };
}

function entriesByPath(entries) {
  return new Map(entries.map(entry => [entry.path, entry]));
}

/**
 * Every tracked file under `company/overlay/` must be declared, and every
 * declaration must be tracked. An undeclared overlay file is a file nobody
 * decided to ship; a declared-but-absent one is a composition that would fail
 * at build time on a deploy runner instead of here.
 */
function assertOverlayCoverage(manifest, source) {
  const tracked = source.entries
    .filter(entry => entry.path.startsWith(`${COMPANY_OVERLAY_ROOT}/`))
    .map(entry => entry.path)
    .sort();
  const declared = manifest.entries.map(entry => entry.source).sort();
  if (canonicalJson(tracked) !== canonicalJson(declared)) {
    const missing = tracked.filter(entry => !declared.includes(entry));
    const absent = declared.filter(entry => !tracked.includes(entry));
    fail(
      [
        'overlay inputs must be exactly declared',
        missing.length ? `undeclared tracked: ${missing.join(', ')}` : null,
        absent.length ? `declared but absent: ${absent.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('; ')
    );
  }
}

function assertAddOnlyTargets(manifest, source) {
  const bySourcePath = entriesByPath(source.entries);
  const basePaths = source.basePaths;

  for (const entry of manifest.entries) {
    const sourceEntry = bySourcePath.get(entry.source);
    if (!sourceEntry) fail(`overlay source is not tracked: ${entry.source}`);
    if (sourceEntry.mode === '120000') {
      fail(`overlay source cannot be a symlink: ${entry.source}`);
    }
    if (!['100644', '100755'].includes(sourceEntry.mode)) {
      fail(
        `overlay source has unsupported mode ${sourceEntry.mode}: ${entry.source}`
      );
    }

    const targetFolded = lowerPath(entry.target);
    for (const basePath of basePaths) {
      const baseFolded = lowerPath(basePath);
      if (
        baseFolded === targetFolded ||
        baseFolded.startsWith(`${targetFolded}/`) ||
        targetFolded.startsWith(`${baseFolded}/`)
      ) {
        fail(
          `mode:add target collides with public path ${basePath}: ${entry.target}`
        );
      }
    }
  }
}

/**
 * Stages a commit's files (or a subset) into `destination`.
 *
 * Deliberately NOT `git archive | tar -x`. That pipeline is two processes
 * racing a shared stream: when `tar` finishes and exits at the same moment the
 * writable side is still settling, Node rejects with `ERR_STREAM_PREMATURE_CLOSE`
 * and the composition fails for a reason that has nothing to do with its
 * inputs. It surfaced on a loaded machine during a landing, which is exactly
 * when a deterministic step must not be probabilistic. Writing the archive to a
 * file first makes the two steps sequential and the result a pure function of
 * the commit.
 */
async function extractGitArchive(repo, commit, destination, paths = []) {
  await mkdir(destination, { recursive: true });
  const staging = await mkdtemp(
    path.join(tmpdir(), 'exawatt-company-archive-')
  );
  const tarball = path.join(staging, 'tree.tar');
  try {
    const archiveArgs = ['archive', '--format=tar', '-o', tarball, commit];
    if (paths.length > 0) archiveArgs.push('--', ...paths);
    await execFileAsync('git', archiveArgs, { cwd: repo });
    await execFileAsync('tar', ['-xf', tarball, '-C', destination]);
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim();
    fail(`archive staging failed: ${detail}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function assertNoSymlinkParent(root, relativePath, label) {
  const segments = relativePath.split('/').slice(0, -1);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (details.isSymbolicLink()) {
      fail(`${label} traverses a symlink: ${relativePath}`);
    }
    if (!details.isDirectory()) {
      fail(`${label} traverses a non-directory: ${relativePath}`);
    }
  }
}

async function applyOverlayEntries({ stage, overlayRoot, entries, modes }) {
  for (const entry of entries) {
    await assertNoSymlinkParent(stage, entry.target, 'overlay target');
    const source = path.join(overlayRoot, ...entry.source.split('/'));
    const target = path.join(stage, ...entry.target.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    await chmod(target, modes.get(entry.source) === '100755' ? 0o755 : 0o644);
  }
}

async function directoryEntries(root, excluded = new Set()) {
  const entries = [];
  async function walk(directory, prefix = '') {
    const children = [];
    for await (const entry of await opendir(directory)) children.push(entry);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of children) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.has(relative)) continue;
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isDirectory()) {
        await walk(absolute, relative);
      } else if (details.isSymbolicLink()) {
        entries.push({
          path: relative,
          mode: '120000',
          sha256: sha256(await readlink(absolute)),
        });
      } else if (details.isFile()) {
        entries.push({
          path: relative,
          mode: (details.mode & 0o111) === 0 ? '100644' : '100755',
          sha256: sha256(await readFile(absolute)),
        });
      } else {
        fail(`composed tree contains unsupported entry: ${relative}`);
      }
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function safeOutputDirectory(outputDir, sourceRepo) {
  const output = path.resolve(outputDir);
  if (output === path.parse(output).root) {
    fail('output cannot be a filesystem root');
  }
  const source = path.resolve(sourceRepo);
  if (output === source) fail('output cannot replace the source repository');
  const relative = path.relative(source, output);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    if (
      relative !== '.company-build' &&
      !relative.startsWith('.company-build/')
    ) {
      fail(
        'output inside the source repository must live under .company-build'
      );
    }
  }
  return output;
}

async function installComposedTree(stage, output) {
  await mkdir(path.dirname(output), { recursive: true });
  const backup = `${output}.previous-${process.pid}-${randomBytes(4).toString('hex')}`;
  let backedUp = false;
  try {
    try {
      await rename(output, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await rename(stage, output);
    if (backedUp) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (backedUp) {
      await rm(output, { recursive: true, force: true });
      await rename(backup, output);
    }
    throw error;
  }
}

export function defaultCompanyOutput(repo, profile) {
  assertCompanyProfile(profile);
  return path.join(repo, '.company-build', PROFILE_OUTPUT_NAMES[profile]);
}

/**
 * Composes one profile into `outputDir` from immutable Git objects.
 *
 * The result is the Gate A public tree at `ref` plus this profile's declared
 * overlay files, and a `.company-composition.json` record naming every input.
 * Repeating it against the same commit produces the same digests, which is what
 * `proveCompanyComposition` asserts.
 */
export async function composeCompanyProfile({
  profile,
  repo,
  ref = 'HEAD',
  outputDir,
  requireClean = true,
}) {
  assertCompanyProfile(profile);
  if (!repo || !outputDir) fail('profile, repo, and outputDir are required');
  const root = path.resolve(repo);
  const output = safeOutputDirectory(outputDir, root);
  if (requireClean) await assertCleanRepository(root, 'company');

  const source = await resolveCompositionSource(root, ref);
  const {
    manifest,
    object: manifestObject,
    sha256: manifestSha256,
  } = await readCompanyOverlayManifestAt(source);
  assertOverlayCoverage(manifest, source);
  assertAddOnlyTargets(manifest, source);

  const selected = manifest.entries.filter(entry => entry.profile === profile);
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = await mkdtemp(
    path.join(path.dirname(output), '.company-compose-')
  );
  const stage = path.join(temporary, 'result');
  const overlayStage = path.join(temporary, 'overlay');
  try {
    await extractGitArchive(root, source.commit, stage, source.basePaths);
    const modes = new Map(
      source.entries.map(entry => [entry.path, entry.mode])
    );
    if (selected.length > 0) {
      await extractGitArchive(
        root,
        source.commit,
        overlayStage,
        selected.map(entry => entry.source)
      );
      await applyOverlayEntries({
        stage,
        overlayRoot: overlayStage,
        entries: selected,
        modes,
      });
    }

    const outputEntries = await directoryEntries(
      stage,
      new Set([COMPANY_COMPOSITION_RECORD])
    );
    const outputTreeDigest = sha256(canonicalJson(outputEntries));
    const bySourcePath = entriesByPath(source.entries);
    const resolvedEntries = [];
    for (const entry of selected) {
      const tracked = bySourcePath.get(entry.source);
      resolvedEntries.push({
        ...entry,
        sourceMode: tracked.mode,
        sourceObject: tracked.object,
        sourceSha256: sha256(await readGitBlob(root, tracked.object)),
      });
    }
    const compositionManifest = {
      schemaVersion: 1,
      profile,
      source: {
        commit: source.commit,
        tree: source.tree,
        pathManifest: source.pathManifest,
        publicPathCount: source.basePaths.length,
        withheldPathCount: source.withheldPaths.length,
      },
      companyOverlay: {
        manifestPath: COMPANY_OVERLAY_MANIFEST,
        manifestObject,
        manifestSha256,
      },
      entries: resolvedEntries,
      outputTree: {
        algorithm: 'sha256-canonical-path-mode-content-v1',
        digest: outputTreeDigest,
        entries: outputEntries,
      },
    };
    const compositionManifestDigest = sha256(
      canonicalJson(compositionManifest)
    );
    const compositionDigest = sha256(
      canonicalJson({ outputTreeDigest, compositionManifestDigest })
    );
    await writeFile(
      path.join(stage, COMPANY_COMPOSITION_RECORD),
      `${JSON.stringify(compositionManifest, null, 2)}\n`
    );
    await installComposedTree(stage, output);
    return {
      profile,
      output,
      commit: source.commit,
      outputTreeDigest,
      compositionManifestDigest,
      compositionDigest,
      overlayEntryCount: selected.length,
      overlayTargets: selected.map(entry => entry.target).sort(),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function proveCompanyComposition({
  profiles = COMPANY_COMPOSITION_PROFILES,
  repo,
  ref = 'HEAD',
}) {
  for (const profile of profiles) assertCompanyProfile(profile);
  const proofRoot = await mkdtemp(
    path.join(tmpdir(), 'exawatt-company-proof-')
  );
  try {
    const results = [];
    for (const profile of profiles) {
      const runs = [];
      for (const attempt of ['first', 'second']) {
        runs.push(
          await composeCompanyProfile({
            profile,
            repo,
            ref,
            outputDir: path.join(
              proofRoot,
              attempt,
              PROFILE_OUTPUT_NAMES[profile]
            ),
          })
        );
      }
      for (const field of [
        'outputTreeDigest',
        'compositionManifestDigest',
        'compositionDigest',
      ]) {
        if (runs[0][field] !== runs[1][field]) {
          fail(`${profile} repeated composition changed ${field}`);
        }
      }
      results.push({
        profile,
        commit: runs[0].commit,
        outputTreeDigest: runs[0].outputTreeDigest,
        compositionManifestDigest: runs[0].compositionManifestDigest,
        compositionDigest: runs[0].compositionDigest,
        overlayEntryCount: runs[0].overlayEntryCount,
        overlayTargets: runs[0].overlayTargets,
      });
    }
    return { schemaVersion: 1, repetitions: 2, results };
  } finally {
    await rm(proofRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// In-place composition — the form a build actually consumes.
// ---------------------------------------------------------------------------

async function readWorkingManifest(root) {
  const file = path.join(root, ...COMPANY_OVERLAY_MANIFEST.split('/'));
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail(`${COMPANY_OVERLAY_MANIFEST} is invalid JSON: ${error.message}`);
  }
  return validateCompanyOverlayManifest(manifest);
}

/**
 * Which declared targets the repository already tracks.
 *
 * Returns `null` when this is not a Git working tree. Deploy runners commonly
 * unpack a source archive rather than a clone, and refusing to build there
 * would turn a safety check into the outage it exists to prevent. The invariant
 * itself is enforced where a repository does exist: `assertAddOnlyTargets`
 * during `company:proof`, and the runtime census, which fails if a hosted
 * entrypoint reappears under `src/app`.
 */
async function trackedPaths(root, candidates) {
  if (candidates.length === 0) return new Set();
  try {
    const stdout = await git(root, ['ls-files', '-z', '--', ...candidates]);
    return new Set(stdout.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

async function pruneEmptyParents(root, relativePath) {
  const segments = relativePath.split('/').slice(0, -1);
  while (segments.length > 0) {
    const directory = path.join(root, ...segments);
    try {
      const remaining = await readdir(directory);
      if (remaining.length > 0) return;
      await rmdir(directory);
    } catch {
      return;
    }
    segments.pop();
  }
}

/**
 * Applies (or withdraws) the overlay in the working tree, and records what it
 * did in `.exawatt-build/company-composition.json`.
 *
 * This is what `pnpm build` runs, so the tree Vercel deploys is the composed
 * tree rather than a separate artifact nobody looks at. Three rules keep it
 * honest:
 *
 *   - a repository with no `company/overlay-manifest.json` is a PUBLIC
 *     checkout: nothing to compose, and this is a documented no-op;
 *   - every declared target is REMOVED first, for every profile, so a
 *     community build after an official one proves absence rather than
 *     inheriting yesterday's routes;
 *   - a declared target that is TRACKED is a hard failure: it means the public
 *     tree grew a file the overlay also owns, and silently overwriting it is
 *     how a private implementation reaches a public repository.
 */
export async function applyCompanyOverlayInPlace({ root, profile }) {
  assertCompositionProfile(profile);
  const repoRoot = path.resolve(root);
  const manifest = await readWorkingManifest(repoRoot);
  if (!manifest) {
    return {
      profile,
      overlay: 'absent',
      applied: [],
      removed: [],
    };
  }

  const declaredTargets = manifest.entries.map(entry => entry.target);
  const tracked = await trackedPaths(repoRoot, declaredTargets);
  if (tracked && tracked.size > 0) {
    fail(
      `the public tree already tracks overlay target(s): ${[...tracked].sort().join(', ')}`
    );
  }

  const removed = [];
  for (const target of [...declaredTargets].sort()) {
    const absolute = path.join(repoRoot, ...target.split('/'));
    try {
      await rm(absolute, { force: false });
      removed.push(target);
      await pruneEmptyParents(repoRoot, target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const selected =
    profile === COMMUNITY_COMPOSITION_PROFILE
      ? []
      : manifest.entries.filter(entry => entry.profile === profile);
  const applied = [];
  for (const entry of selected) {
    const source = path.join(repoRoot, ...entry.source.split('/'));
    const target = path.join(repoRoot, ...entry.target.split('/'));
    let bytes;
    try {
      bytes = await readFile(source);
    } catch (error) {
      return fail(
        `overlay source is missing and this build declares ${profile}: ${entry.source} (${error.code ?? error.message})`
      );
    }
    await assertNoSymlinkParent(repoRoot, entry.target, 'overlay target');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    applied.push({
      source: entry.source,
      target: entry.target,
      role: entry.role,
      sha256: sha256(bytes),
    });
  }

  const record = {
    schemaVersion: 1,
    profile,
    overlay: 'present',
    trackedTargetCheck: tracked === null ? 'skipped-no-git' : 'passed',
    manifestPath: COMPANY_OVERLAY_MANIFEST,
    applied: applied.sort((a, b) => a.target.localeCompare(b.target)),
    removed,
  };
  const statePath = path.join(
    repoRoot,
    ...COMPANY_COMPOSITION_STATE.split('/')
  );
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/**
 * Reads what the last in-place composition did. Absent state means no build has
 * composed in this checkout yet, which callers must treat as "unknown", never as
 * "community".
 */
export async function readCompositionState(root) {
  const statePath = path.join(
    path.resolve(root),
    ...COMPANY_COMPOSITION_STATE.split('/')
  );
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Chooses the composition profile for a build.
 *
 * `EXAWATT_COMPOSITION_PROFILE` is the explicit declaration; the package
 * scripts that build the DESKTOP application set `official-desktop` so a DMG
 * never carries hosted routes. Otherwise the profile follows the distribution:
 * a community contract composes nothing, and any other contract is a hosted web
 * build. The default leans toward `official-web` on purpose — incident `0017`
 * is a hosted deployment that silently lost capability, and losing a route is
 * the failure that hurts.
 */
export function resolveCompositionProfile({ env = {}, distributionSource }) {
  const declared = env.EXAWATT_COMPOSITION_PROFILE;
  if (declared !== undefined && declared !== '') {
    return assertCompositionProfile(declared, 'EXAWATT_COMPOSITION_PROFILE');
  }
  return distributionSource === 'community-default'
    ? COMMUNITY_COMPOSITION_PROFILE
    : 'official-web';
}
