import { execFile, spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EVIDENCE_SCHEMA_VERSION = 1;
const REQUIRED_PUBLIC_PATHS = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'scripts/open-source-paths.manifest.json',
]);
const PROJECTION_WORKER = new URL(
  './exact-public-projection-worker.mjs',
  import.meta.url
);

/**
 * One canonical sequence for the expensive, exact-tree claim. The publication
 * composite owns classification, whole-tree content, production audit,
 * licensing, asset provenance, community policy, and publication tests. The
 * remaining rows prove the built and packaged behavior that static publication
 * checks cannot see.
 */
export const EXACT_PUBLIC_GATES = Object.freeze([
  Object.freeze({
    id: 'frozen-install',
    command: 'pnpm',
    args: Object.freeze(['install', '--frozen-lockfile']),
    proves: Object.freeze(['reproducible-dependency-resolution']),
  }),
  Object.freeze({
    id: 'publication',
    command: 'pnpm',
    args: Object.freeze(['publication:check']),
    proves: Object.freeze([
      'classification',
      'content',
      'production-audit',
      'licenses',
      'asset-provenance',
      'community-policy',
      'publication-tests',
    ]),
  }),
  Object.freeze({
    id: 'community-icon',
    command: 'pnpm',
    args: Object.freeze(['icon:check']),
    proves: Object.freeze(['community-icon-integrity']),
  }),
  Object.freeze({
    id: 'lint',
    command: 'pnpm',
    args: Object.freeze(['lint']),
    proves: Object.freeze(['static-lint']),
  }),
  Object.freeze({
    id: 'type-check',
    command: 'pnpm',
    args: Object.freeze(['type-check']),
    proves: Object.freeze(['renderer-and-electron-test-types']),
  }),
  Object.freeze({
    id: 'electron-compile',
    command: 'pnpm',
    args: Object.freeze(['electron:compile']),
    proves: Object.freeze(['electron-main-compilation']),
  }),
  Object.freeze({
    id: 'public-test-suite',
    command: 'pnpm',
    args: Object.freeze(['test:ci']),
    proves: Object.freeze(['public-product-tests']),
  }),
  Object.freeze({
    id: 'delivery-test-suite',
    command: 'pnpm',
    args: Object.freeze(['test:agent-delivery']),
    proves: Object.freeze(['public-delivery-contracts']),
  }),
  Object.freeze({
    id: 'community-build',
    command: 'pnpm',
    args: Object.freeze(['verify:community-build']),
    proves: Object.freeze(['secretless-next-build']),
  }),
  Object.freeze({
    id: 'community-runtime',
    command: 'pnpm',
    args: Object.freeze(['verify:community-runtime']),
    proves: Object.freeze(['unconfigured-runtime-degradation']),
  }),
  Object.freeze({
    id: 'compatibility-contracts',
    command: 'pnpm',
    args: Object.freeze(['test:contracts']),
    proves: Object.freeze(['published-contract-conformance']),
  }),
  Object.freeze({
    id: 'community-package',
    command: 'pnpm',
    args: Object.freeze(['electron:build:dir']),
    proves: Object.freeze(['unsigned-community-package']),
  }),
  Object.freeze({
    id: 'packaged-runtime',
    command: 'pnpm',
    args: Object.freeze(['eval:electron:packaged']),
    proves: Object.freeze(['packaged-renderer-runtime']),
  }),
  Object.freeze({
    id: 'packaged-network',
    command: 'pnpm',
    args: Object.freeze(['eval:community:network']),
    proves: Object.freeze(['zero-default-exawatt-network']),
  }),
]);

const AMBIENT_ENV_ALLOWLIST = Object.freeze([
  'COLORTERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
]);

function fail(message) {
  throw new Error(`[exact-public] ${message}`);
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

async function processTable() {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,pgid=']);
  return stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/u).map(Number))
    .filter(parts => parts.length === 2 && parts.every(Number.isFinite))
    .map(([pid, pgid]) => ({ pid, pgid }));
}

async function processGroupMembers(group) {
  return (await processTable()).filter(entry => entry.pgid === group);
}

const waitForProcessEffect = delayMs =>
  new Promise(resolve => setTimeout(resolve, delayMs));

async function terminateOwnedProcessGroup(group, graceMs = 1_500) {
  if (process.platform === 'win32') return [];
  const table = await processTable();
  const members = table.filter(entry => entry.pgid === group);
  if (members.length === 0) return [];
  const ownGroup = table.find(entry => entry.pid === process.pid)?.pgid;
  if (group === ownGroup) {
    throw new Error(
      `[exact-public] refused to signal recertifier process group ${group}`
    );
  }

  try {
    process.kill(-group, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }

  const deadline = Date.now() + graceMs;
  let survivors = await processGroupMembers(group);
  while (survivors.length > 0 && Date.now() < deadline) {
    await waitForProcessEffect(75);
    survivors = await processGroupMembers(group);
  }
  if (survivors.length > 0) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await waitForProcessEffect(100);
    survivors = await processGroupMembers(group);
  }
  if (survivors.length > 0) {
    throw new Error(
      `[exact-public] could not stop process group ${group}; survivors: ${survivors
        .map(entry => entry.pid)
        .join(', ')}`
    );
  }
  return members;
}

export function runRecertificationProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error('recertification aborted'));
      return;
    }
    const ownsProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      detached: ownsProcessGroup,
    });
    const stdout = [];
    if (options.capture) {
      child.stdout.on('data', chunk => {
        stdout.push(chunk);
        options.onStdout?.(chunk);
      });
    }
    let settled = false;
    let exit = null;
    let abortReason = null;
    let terminationPromise = null;
    let lifecyclePromise = null;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', terminateGroup);
      callback(value);
    };
    const terminate = () => {
      if (!child.pid) return Promise.resolve([]);
      if (!terminationPromise) {
        terminationPromise = ownsProcessGroup
          ? terminateOwnedProcessGroup(child.pid, options.terminationGraceMs)
          : Promise.resolve().then(() => {
              child.kill('SIGTERM');
              return [];
            });
        // An abort can begin termination before `exit`; attach a handler now
        // so the eventual awaited rejection is never reported as unhandled.
        void terminationPromise.catch(() => {});
      }
      return terminationPromise;
    };
    const terminateGroup = () => {
      abortReason =
        options.signal?.reason ?? new Error('recertification aborted');
      void terminate();
    };
    options.signal?.addEventListener('abort', terminateGroup, { once: true });
    child.once('error', error => {
      settle(reject, error);
    });
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      lifecyclePromise = (async () => {
        if (abortReason || code !== 0) {
          await terminate();
          return;
        }
        if (!ownsProcessGroup || !child.pid) return;
        const leaked = await processGroupMembers(child.pid);
        if (leaked.length === 0) return;
        await terminate();
        throw new Error(
          `${commandLabel(command, args)} left descendant processes in group ${child.pid}: ${leaked
            .map(entry => entry.pid)
            .join(', ')}`
        );
      })();
      void lifecyclePromise.catch(() => {});
    });
    child.once('close', async () => {
      try {
        await lifecyclePromise;
      } catch (error) {
        settle(reject, error);
        return;
      }
      if (abortReason) {
        settle(reject, abortReason);
        return;
      }
      if (exit?.code === 0) {
        settle(
          resolve,
          options.capture ? Buffer.concat(stdout).toString('utf8') : ''
        );
        return;
      }
      settle(
        reject,
        new Error(
          exit?.signal
            ? `${commandLabel(command, args)} exited on ${exit.signal}`
            : `${commandLabel(command, args)} exited with ${exit?.code ?? 'unknown'}`
        )
      );
    });
  });
}

/**
 * State an environment instead of subtracting two known official variables
 * from an arbitrary shell. That keeps GitHub tokens, provider credentials,
 * signing custody, Vercel values, and future secret names out by default.
 */
export function buildExactPublicEnvironment(ambient, { cleanHome, cleanTemp }) {
  const env = {};
  for (const key of AMBIENT_ENV_ALLOWLIST) {
    if (typeof ambient[key] === 'string' && ambient[key].length > 0) {
      env[key] = ambient[key];
    }
  }
  env.HOME = cleanHome;
  env.TMPDIR = cleanTemp;
  env.CI = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.EXAWATT_MACHINE_SLOTS = '0';
  env.COREPACK_HOME = path.join(cleanHome, '.cache', 'corepack');
  env.npm_config_cache = path.join(cleanHome, '.cache', 'npm');
  env.ELECTRON_CACHE = path.join(cleanHome, '.cache', 'electron');
  env.ELECTRON_BUILDER_CACHE = path.join(
    cleanHome,
    '.cache',
    'electron-builder'
  );
  return env;
}

async function projectPublicHistoryInChild(
  { sourceRepo, sourceSha, destination, publicAnchor },
  { run, signal, environment }
) {
  const stdout = await run(
    process.execPath,
    [
      fileURLToPath(PROJECTION_WORKER),
      sourceRepo,
      sourceSha,
      destination,
      ...(publicAnchor ? [publicAnchor] : []),
    ],
    {
      cwd: sourceRepo,
      env: environment,
      capture: true,
      signal,
    }
  );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(`projection worker returned invalid JSON: ${error.message}`);
  }
}

async function captureGit(
  root,
  args,
  run = runRecertificationProcess,
  signal = undefined
) {
  return (
    await run('git', args, {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? tmpdir(),
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      capture: true,
      signal,
    })
  ).trim();
}

async function cloneProjection(
  source,
  destination,
  run = runRecertificationProcess,
  signal = undefined
) {
  await run(
    'git',
    [
      'clone',
      '--quiet',
      '--no-hardlinks',
      '--no-local',
      '--no-tags',
      '--branch',
      'master',
      source,
      destination,
    ],
    {
      cwd: path.dirname(destination),
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? tmpdir(),
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      signal,
    }
  );
}

async function assertPublicCheckout(
  checkout,
  expectedSha,
  run = runRecertificationProcess,
  signal = undefined
) {
  const actualSha = await captureGit(
    checkout,
    ['rev-parse', 'HEAD'],
    run,
    signal
  );
  if (actualSha !== expectedSha) {
    fail(`clone HEAD ${actualSha} does not match projection ${expectedSha}`);
  }
  const status = await captureGit(
    checkout,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    run,
    signal
  );
  if (status) fail(`fresh public clone is dirty: ${status.split('\n')[0]}`);

  for (const required of REQUIRED_PUBLIC_PATHS) {
    try {
      await access(path.join(checkout, required));
    } catch {
      fail(`public clone is missing required path ${required}`);
    }
  }

  await assertNoEnvironmentCustody(checkout);
  const packageJson = JSON.parse(
    await readFile(path.join(checkout, 'package.json'), 'utf8')
  );
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageJson.packageManager ?? '')) {
    fail(
      'public packageManager must pin one exact pnpm version before a frozen install'
    );
  }
  return { actualSha, packageManager: packageJson.packageManager };
}

async function assertNoEnvironmentCustody(checkout) {
  const forbidden = (await readdir(checkout)).find(
    basename => basename === '.env' || basename.startsWith('.env.')
  );
  if (forbidden) {
    fail(`public clone carries environment custody at ${forbidden}`);
  }
}

function validateProjection(projection) {
  for (const key of ['sourceSha', 'publicSha', 'planDigest']) {
    if (typeof projection?.[key] !== 'string' || projection[key].length === 0) {
      fail(`projector returned no ${key}`);
    }
  }
  if (!Array.isArray(projection.projectedPaths)) {
    fail('projector returned no projectedPaths');
  }
  if (!Array.isArray(projection.unrenderedOutputs)) {
    fail('projector returned no unrenderedOutputs result');
  }
  if (projection.unrenderedOutputs.length > 0) {
    const first = projection.unrenderedOutputs[0];
    fail(
      `projector omitted unrendered output ${first.path ?? '<unknown>'} (${first.recipe ?? first.reason ?? 'unknown recipe'})`
    );
  }
}

async function runExactPublicCertification(options) {
  const sourceSelector = options.sourceSelector ?? '<candidate>';
  const run = options.run ?? runRecertificationProcess;
  const clone = options.clone ?? cloneProjection;
  const createTemporaryRoot =
    options.createTemporaryRoot ??
    (() => mkdtemp(path.join(tmpdir(), 'exawatt-exact-public-')));
  const removeTemporaryRoot =
    options.removeTemporaryRoot ??
    (root => rm(root, { recursive: true, force: true }));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (message => process.stdout.write(`${message}\n`));
  const gates = options.gates ?? EXACT_PUBLIC_GATES;
  const signal = options.signal;

  const temporaryRoot = await createTemporaryRoot();
  const projectionRoot = path.join(temporaryRoot, 'projection');
  const checkoutRoot = path.join(temporaryRoot, 'checkout');
  const cleanHome = path.join(temporaryRoot, 'home');
  const cleanTemp = path.join(temporaryRoot, 'tmp');
  let evidence = null;
  let projection = null;
  let activeGate = null;
  let failure = null;

  try {
    await Promise.all([
      mkdir(cleanHome, { recursive: true }),
      mkdir(cleanTemp, { recursive: true }),
    ]);
    const environment = buildExactPublicEnvironment(
      options.ambientEnv ?? process.env,
      {
        cleanHome,
        cleanTemp,
      }
    );
    log(options.beginLabel);
    projection = await options.prepareCandidate({
      projectionRoot,
      environment,
      run,
      signal,
    });
    validateProjection(projection);

    await clone(projection.candidateRepo, checkoutRoot, run, signal);
    const checkout = await assertPublicCheckout(
      checkoutRoot,
      projection.publicSha,
      run,
      signal
    );
    const results = [];
    activeGate = { id: 'package-manager-identity' };
    const declaredPnpmVersion = checkout.packageManager.slice('pnpm@'.length);
    const observedPnpmVersion = (
      await run('pnpm', ['--version'], {
        cwd: checkoutRoot,
        env: environment,
        capture: true,
        signal,
      })
    ).trim();
    if (observedPnpmVersion !== declaredPnpmVersion) {
      fail(
        `packageManager declares pnpm@${declaredPnpmVersion}, but pnpm --version returned ${observedPnpmVersion || '<empty>'}`
      );
    }
    activeGate = null;

    for (const gate of gates) {
      if (signal?.aborted) throw signal.reason;
      activeGate = gate;
      const startedAt = now();
      log(
        `[exact-public] ${gate.id}: ${commandLabel(gate.command, gate.args)}`
      );
      try {
        await run(gate.command, [...gate.args], {
          cwd: checkoutRoot,
          env: environment,
          signal,
        });
        await assertNoEnvironmentCustody(checkoutRoot);
      } catch (error) {
        error.message = `[exact-public] ${gate.id} failed for public ${projection.publicSha}: ${error.message}`;
        throw error;
      }
      const finishedAt = now();
      results.push({
        id: gate.id,
        command: commandLabel(gate.command, gate.args),
        proves: [...gate.proves],
        status: 'passed',
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      });
      activeGate = null;
    }

    const finalSha = await captureGit(
      checkoutRoot,
      ['rev-parse', 'HEAD'],
      run,
      signal
    );
    if (finalSha !== projection.publicSha) {
      fail(
        `public gates changed HEAD from ${projection.publicSha} to ${finalSha}`
      );
    }
    const finalStatus = await captureGit(
      checkoutRoot,
      ['status', '--porcelain=v1', '--untracked-files=no'],
      run,
      signal
    );
    if (finalStatus) {
      fail(
        `public gates changed tracked source: ${finalStatus.split('\n')[0]}`
      );
    }

    evidence = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      verifiedAt: now().toISOString(),
      sourceSha: projection.sourceSha,
      publicSha: projection.publicSha,
      planDigest: projection.planDigest,
      projectedPathCount: projection.projectedPaths.length,
      unrenderedOutputCount: projection.unrenderedOutputs.length,
      packageManager: {
        declared: checkout.packageManager,
        observedVersion: observedPnpmVersion,
      },
      environment: 'clean-room-community',
      gates: results,
      status: 'passed',
    };
  } catch (error) {
    failure = error;
  }

  try {
    await removeTemporaryRoot(temporaryRoot);
  } catch (cleanupError) {
    const namedCleanupError = new Error(
      `[exact-public] temporary cleanup failed: ${cleanupError?.message ?? String(cleanupError)}`,
      { cause: cleanupError }
    );
    failure = failure
      ? new AggregateError(
          [failure, namedCleanupError],
          `${failure.message}; ${namedCleanupError.message}`,
          { cause: failure }
        )
      : namedCleanupError;
  }

  if (failure) {
    const failedEvidence = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      verifiedAt: now().toISOString(),
      sourceSha: projection?.sourceSha ?? sourceSelector,
      publicSha: projection?.publicSha ?? null,
      planDigest: projection?.planDigest ?? null,
      failedGate: activeGate?.id ?? null,
      status: 'failed',
      reason: failure?.message ?? String(failure),
    };
    log(`[exact-public] evidence ${JSON.stringify(failedEvidence)}`);
    throw failure;
  }

  log(`[exact-public] evidence ${JSON.stringify(evidence)}`);
  return evidence;
}

/**
 * Clone an already-materialized public candidate into disposable custody and
 * run the exact publication, build, runtime, package, and network floor. The
 * caller supplies projector metadata so the returned evidence remains bound
 * to the immutable private/public SHA pair and projection-plan digest.
 */
export async function certifyExactPublicCandidate(options) {
  if (typeof options.candidateRepo !== 'string' || !options.candidateRepo) {
    fail('candidateRepo is required');
  }
  const candidateRepo = path.resolve(options.candidateRepo);
  const expectedPublicSha = options.expectedPublicSha;

  return runExactPublicCertification({
    ...options,
    sourceSelector: options.sourceSha ?? '<candidate-source>',
    beginLabel: `[exact-public] certifying materialized candidate ${expectedPublicSha ?? '<missing-sha>'}`,
    prepareCandidate: async () => ({
      candidateRepo,
      sourceSha: options.sourceSha,
      publicSha: expectedPublicSha,
      planDigest: options.planDigest,
      projectedPaths: options.projectedPaths,
      unrenderedOutputs: options.unrenderedOutputs,
    }),
  });
}

/**
 * Project one immutable private commit locally, then certify its materialized
 * public candidate. No remote is read or written: published-snapshot epochs
 * require an explicitly supplied local publicAnchor repository.
 */
export async function runExactPublicRecertification(options) {
  const sourceRepo = path.resolve(options.sourceRepo);
  const sourceSha = options.sourceSha ?? 'HEAD';

  return runExactPublicCertification({
    ...options,
    sourceSelector: sourceSha,
    beginLabel: `[exact-public] projecting ${sourceSha} locally`,
    prepareCandidate: async ({ projectionRoot, environment, run, signal }) => {
      const project =
        options.project ??
        (input =>
          projectPublicHistoryInChild(input, {
            run,
            signal,
            environment,
          }));
      const projection = await project({
        sourceRepo,
        sourceSha,
        destination: projectionRoot,
        ...(options.publicAnchor
          ? { publicAnchor: path.resolve(options.publicAnchor) }
          : {}),
        signal,
      });
      return { ...projection, candidateRepo: projectionRoot };
    },
  });
}
