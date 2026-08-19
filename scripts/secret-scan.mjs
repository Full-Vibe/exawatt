#!/usr/bin/env node

/**
 * ENG-030 OS5.3. Secret-scans THIS repository's complete history with the same
 * gitleaks version, configuration and ruleset the public repository's
 * `.github/workflows/gitleaks.yml` runs, so the private side of the boundary is
 * a command anyone can re-run rather than a claim in a document.
 *
 * **Why one pass over the private history answers both questions.**
 *
 * There are two trees at stake and they are not the same: the projected public
 * repository (what strangers clone) and this repository (never published, but a
 * credential that ever existed here would still be live). The public one is
 * built by `scripts/lib/public-projection.mjs`, and the projection is
 * subtractive: a projected path is either a PUBLIC blob copied verbatim, or a
 * GENERATED output that `recipe-renderers.mjs` produces by dropping lines and
 * uncommenting lines that were already present in the private source blob. It
 * adds exactly one thing — a fixed "Generated for the public repository by the
 * … recipe." notice line. So every byte sequence that can appear in public
 * history already appears in private history at the same path, and the set of
 * projected paths is a subset of the tracked paths.
 *
 * Scanning this repository's complete history is therefore a CONSERVATIVE
 * SUPERSET of scanning the projection: a finding the public gate would raise
 * must also be raised here, while the reverse does not hold. That matters
 * because it makes the private scan usable before a public repository exists,
 * and it keeps this gate honest afterwards — it can only over-report.
 *
 * What it deliberately does NOT prove: that the projection is correct, that
 * classification is right, or that a binary is clean. `open-source:paths:check`
 * owns the first two and `content:scan`'s image-metadata rules own the third,
 * because gitleaks reads patches and a patch has no bytes for a binary file.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pinned to the version and checksums `.github/workflows/gitleaks.yml` installs
 * — `secret-scan.test.mjs` fails when the two drift, because a local gate that
 * runs a different ruleset than CI is worse than no local gate. Checksums come
 * from `gitleaks_<version>_checksums.txt` in the same GitHub release.
 */
export const GITLEAKS_VERSION = '8.30.1';
export const GITLEAKS_ARCHIVE_SHA256 = Object.freeze({
  darwin_arm64:
    'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  darwin_x64:
    'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  linux_arm64:
    'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
});

export function releaseTarget(
  platform = process.platform,
  arch = process.arch
) {
  const os = { darwin: 'darwin', linux: 'linux' }[platform];
  const cpu = { arm64: 'arm64', x64: 'x64' }[arch];
  if (!os || !cpu) {
    throw new Error(
      `[secret-scan] no pinned gitleaks build for ${platform}/${arch}. Install ` +
        'gitleaks yourself and set EXAWATT_GITLEAKS_BIN to its path.'
    );
  }
  const key = `${os}_${cpu}`;
  return {
    key,
    archive: `gitleaks_${GITLEAKS_VERSION}_${key}.tar.gz`,
    sha256: GITLEAKS_ARCHIVE_SHA256[key],
    url:
      'https://github.com/gitleaks/gitleaks/releases/download/' +
      `v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${key}.tar.gz`,
  };
}

async function commonGitDir(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--git-common-dir'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
  return path.resolve(root, stdout.trim());
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Resolves the pinned binary, downloading it once per machine into the shared
 * Git directory so every agent worktree reuses the same verified copy. The
 * download is checksum-verified before it is ever executed; a mismatch removes
 * the bytes rather than caching them.
 */
export async function resolveGitleaks({ root = ROOT, log = console.log } = {}) {
  const override = process.env.EXAWATT_GITLEAKS_BIN;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `[secret-scan] EXAWATT_GITLEAKS_BIN does not exist: ${override}`
      );
    }
    return { binary: override, source: 'EXAWATT_GITLEAKS_BIN' };
  }
  const target = releaseTarget();
  const cache = path.join(
    await commonGitDir(root),
    'exawatt-tools',
    `gitleaks-${GITLEAKS_VERSION}-${target.key}`
  );
  const binary = path.join(cache, 'gitleaks');
  if (existsSync(binary)) return { binary, source: 'cache' };

  log(
    `[secret-scan] downloading checksum-pinned gitleaks ${GITLEAKS_VERSION} (${target.key})`
  );
  const response = await fetch(target.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`[secret-scan] ${target.url} responded ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== target.sha256) {
    throw new Error(
      `[secret-scan] ${target.archive} hashes to ${digest}, not the pinned ` +
        `${target.sha256}. Refusing to run an unverified scanner.`
    );
  }
  const staging = await mkdtemp(path.join(tmpdir(), 'exawatt-gitleaks-'));
  try {
    const archive = path.join(staging, target.archive);
    await writeFile(archive, bytes);
    await execFileAsync('tar', ['-xzf', archive, '-C', staging, 'gitleaks']);
    await chmod(path.join(staging, 'gitleaks'), 0o755);
    await mkdir(path.dirname(cache), { recursive: true });
    await rm(cache, { recursive: true, force: true });
    await rename(staging, cache);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { binary, source: 'download' };
}

function run(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`gitleaks exited on ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function scanRepositoryHistory({
  root = ROOT,
  log = console.log,
} = {}) {
  const { binary, source } = await resolveGitleaks({ root, log });
  log(
    `[secret-scan] gitleaks ${GITLEAKS_VERSION} (${source}) over every ref in ${root}`
  );
  // `--log-opts=--all` widens the scan past the checked-out branch to every
  // ref this checkout can see, so an unlanded `agent/*` branch that committed a
  // credential is covered too. `--redact` keeps a finding's value out of the
  // terminal and out of any log an agent pastes into a session.
  const code = await run(
    binary,
    [
      'git',
      '--config',
      path.join(root, 'scripts/gitleaks.toml'),
      '--redact',
      '--no-banner',
      '--exit-code',
      '1',
      '--log-opts=--all',
      '.',
    ],
    { cwd: root }
  );
  return code;
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      [
        'Usage: pnpm security:secrets',
        '',
        'Scans every ref of this repository with the pinned gitleaks the public',
        'repository CI runs. Set EXAWATT_GITLEAKS_BIN to use a gitleaks you',
        'already trust instead of downloading the pinned release.',
        '',
        'Record a reviewed finding by its exact secret value in',
        'scripts/gitleaks.toml, or by commit fingerprint in .gitleaksignore.',
        'Never allowlist a path: that hides the next real key under it.',
        '',
      ].join('\n')
    );
    return;
  }
  const code = await scanRepositoryHistory();
  if (code !== 0) {
    process.stderr.write(
      '[secret-scan] gitleaks reported findings. Classify each one before ' +
        'allowlisting it, and rotate anything whose exposure cannot be ' +
        'disproved. Never allowlist by path.\n'
    );
    process.exitCode = code;
    return;
  }
  process.stdout.write('[secret-scan] no findings across every ref\n');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
