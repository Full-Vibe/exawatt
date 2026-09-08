#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import { appendDeliveryMetric } from './lib/delivery-state.mjs';
import {
  PUBLIC_BRANCH,
  PUBLIC_REMOTE_NAME,
  resolvePublicRemote,
} from './lib/public-delivery.mjs';
import { projectPublicHistory } from './lib/public-projection.mjs';
import { readSourceLock, recordSourceLock } from './lib/public-source-lock.mjs';
import { runAudit as runPublicMetadataAudit } from './public-metadata-audit.mjs';
import { scanRepositoryHistory } from './secret-scan.mjs';

/**
 * The deliberate non-fast-forward path (ENG-030 WP6-D).
 *
 * A manifest change can reclassify history — a path flips PRIVATE → PUBLIC, or
 * a recipe becomes executable — so the projection of today's source is no
 * longer a descendant of what the public repository already holds. The landing
 * projector REFUSES that, always, and never forces. This command is the only
 * one that may force, it forces exactly once, and it records why in the source
 * lock.
 *
 * It is deliberately hard to invoke: an explicit environment opt-in, an exact
 * confirmation token, and a written reason, and it refuses outright when the
 * projection would fast-forward, because then a normal landing publishes it
 * and no force is warranted.
 */

const execFileAsync = promisify(execFile);

export const RESEED_CONFIRMATION = 'reseed-public-history';
export const RESEED_ENV = 'EXAWATT_OPEN_SOURCE_ALLOW_RESEED';
const MINIMUM_REASON = 20;

function fail(message) {
  throw new Error(`[open-source-reseed] ${message}`);
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

export function parseArgs(argv) {
  const options = { reason: null, confirm: null, source: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--reason', '--confirm', '--source'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else fail(`unknown argument: ${argument}`);
  }
  return options;
}

export function usage() {
  return `Usage: ${RESEED_ENV}=1 pnpm open-source:reseed -- \\
  --confirm ${RESEED_CONFIRMATION} --reason "<why history was reclassified>"

Force-publishes the current projection over a public master it does not
descend from. This rewrites public history for everyone who has cloned it.
Use it only when a manifest change reclassified history; a landing publishes
every ordinary change by fast-forward.

  --confirm <token>  Must be exactly ${RESEED_CONFIRMATION}.
  --reason <text>    Recorded in the source lock. At least ${MINIMUM_REASON} characters.
  --source <commit>  Private commit to project. Defaults to origin/master.
`;
}

export function assertDeliberate(options, environment = process.env) {
  if (environment[RESEED_ENV] !== '1') {
    fail(
      `a reseed rewrites published history; set ${RESEED_ENV}=1 explicitly to allow it`
    );
  }
  if (options.confirm !== RESEED_CONFIRMATION) {
    fail(`--confirm must be exactly ${RESEED_CONFIRMATION}`);
  }
  if (
    typeof options.reason !== 'string' ||
    options.reason.trim().length < MINIMUM_REASON
  ) {
    fail(
      `--reason must say why history was reclassified, in at least ${MINIMUM_REASON} characters`
    );
  }
  return true;
}

export function reseedPushArgs({ url, branch = PUBLIC_BRANCH, expected }) {
  if (!/^[0-9a-f]{40}$/u.test(expected ?? '')) {
    fail('a reseed pushes against the exact public tip it observed');
  }
  // One force, leased against the tip this run observed and refused, so a
  // public master that moved after the refusal is not silently destroyed.
  return [
    'push',
    '--quiet',
    `--force-with-lease=refs/heads/${branch}:${expected}`,
    url,
    `refs/heads/${branch}:refs/heads/${branch}`,
  ];
}

async function certifyPublishedRemote({
  root,
  parent,
  remote,
  expectedPublicSha,
  metadataAudit,
  secretScan,
  log,
}) {
  const observed = (await git(root, 'ls-remote', remote.url, PUBLIC_BRANCH))
    .split('\t')[0]
    .trim();
  if (observed !== expectedPublicSha) {
    fail(
      `published remote read-back is ${observed || '<empty>'}, not ` +
        expectedPublicSha
    );
  }
  const mirror = path.join(parent, 'published.git');
  const worktree = path.join(parent, 'published');
  await rm(mirror, { recursive: true, force: true });
  await rm(worktree, { recursive: true, force: true });
  await execFileAsync(
    'git',
    ['clone', '--quiet', '--mirror', '--no-local', remote.url, mirror],
    { cwd: parent, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
  );
  const mirrorMaster = await git(
    mirror,
    'rev-parse',
    '--verify',
    `refs/heads/${PUBLIC_BRANCH}^{commit}`
  );
  if (mirrorMaster !== expectedPublicSha) {
    fail(
      `mirror captured public ${mirrorMaster}, not expected ${expectedPublicSha}`
    );
  }
  await execFileAsync(
    'git',
    [
      `--git-dir=${mirror}`,
      'worktree',
      'add',
      '--quiet',
      '--detach',
      worktree,
      `refs/heads/${PUBLIC_BRANCH}`,
    ],
    { cwd: parent }
  );
  const audit = await metadataAudit({
    repo: mirror,
    refs: [],
    format: 'json',
    forbiddenVocabulary: null,
    allowLegacyCommitter: false,
  });
  if (audit.reseedRequired || audit.tags !== 0) {
    fail(
      `published remote metadata postcondition found ${audit.findings.length} ` +
        `finding(s) and ${audit.tags} tag(s)`
    );
  }
  const secretScanCode = await secretScan({ root: worktree, log });
  if (secretScanCode !== 0) {
    fail(
      `published remote complete-history gitleaks postcondition exited ${secretScanCode}`
    );
  }
  const finalObserved = (
    await git(root, 'ls-remote', remote.url, PUBLIC_BRANCH)
  )
    .split('\t')[0]
    .trim();
  if (finalObserved !== expectedPublicSha) {
    fail(
      `public remote moved to ${finalObserved || '<empty>'} during certification`
    );
  }
  return audit;
}

function sourceLockEvidence(record) {
  const { schemaVersion, at, status, ...evidence } = record;
  void schemaVersion;
  void at;
  void status;
  return evidence;
}

export async function reseedPublicRepository({
  root,
  reason,
  source = null,
  log = console.log,
  metadataAudit = runPublicMetadataAudit,
  secretScan = scanRepositoryHistory,
  push = (cwd, args) =>
    execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }),
}) {
  const remote = await resolvePublicRemote(root);
  if (!remote) {
    fail(
      `no ${PUBLIC_REMOTE_NAME} remote is configured, so there is no public repository to reseed`
    );
  }
  const advertised = await git(root, 'ls-remote', remote.url, PUBLIC_BRANCH);
  const existingPublicSha = advertised.split('\t')[0] ?? '';
  if (!/^[0-9a-f]{40}$/u.test(existingPublicSha)) {
    fail(
      `the public remote has no ${PUBLIC_BRANCH}; the first publication is an ordinary landing, not a reseed`
    );
  }
  const unexpectedRefs = (await git(root, 'ls-remote', remote.url))
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(/\s/u)[1])
    .filter(ref => ref !== 'HEAD' && ref !== `refs/heads/${PUBLIC_BRANCH}`);
  if (unexpectedRefs.length > 0) {
    fail(
      `the public remote advertises ${unexpectedRefs.length} additional ref(s); ` +
        'a master-only reseed would leave their old history reachable'
    );
  }

  if (!source) {
    fail(
      '--source is required and must name the freshly fetched origin/master'
    );
  }
  await git(root, 'fetch', '--quiet', 'origin', 'master');
  const originMaster = await git(
    root,
    'rev-parse',
    '--verify',
    'origin/master^{commit}'
  );
  const sourceSha = await git(
    root,
    'rev-parse',
    '--verify',
    `${source}^{commit}`
  );
  if (sourceSha !== originMaster) {
    fail(
      `--source resolves to ${sourceSha}, not freshly fetched origin/master ${originMaster}`
    );
  }

  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-reseed-'));
  const lock = await acquireDeliveryLock(root);
  try {
    await git(root, 'fetch', '--quiet', 'origin', 'master');
    const lockedOriginMaster = await git(
      root,
      'rev-parse',
      '--verify',
      'origin/master^{commit}'
    );
    if (lockedOriginMaster !== sourceSha) {
      fail(
        `origin/master moved from selected ${sourceSha} to ${lockedOriginMaster} while acquiring the delivery lock`
      );
    }
    const lockedPublicSha = (
      await git(root, 'ls-remote', remote.url, PUBLIC_BRANCH)
    )
      .split('\t')[0]
      .trim();
    if (lockedPublicSha !== existingPublicSha) {
      fail(
        `public master moved from ${existingPublicSha} to ${lockedPublicSha} while acquiring the delivery lock`
      );
    }
    const priorIntent = (await readSourceLock(root)).at(-1);
    if (priorIntent?.status === 'reseed-intent') {
      if (
        priorIntent.privateSha !== sourceSha ||
        priorIntent.reason !== reason ||
        priorIntent.publicRepository !== remote.url
      ) {
        fail(
          'an unresolved reseed intent does not match this source, reason, or public repository; refusing ambiguous recovery'
        );
      }
      if (existingPublicSha === priorIntent.previousPublicSha) {
        const retryProjection = await projectPublicHistory({
          sourceRepo: root,
          sourceSha,
          destination: path.join(parent, 'retry-public'),
          rebuildHistory: true,
        });
        if (retryProjection.publicSha !== priorIntent.publicSha) {
          fail(
            `reseed intent candidate was ${priorIntent.publicSha}, but regeneration produced ${retryProjection.publicSha}`
          );
        }
        const retryAudit = await metadataAudit({
          repo: retryProjection.destination,
          refs: [],
          format: 'json',
          forbiddenVocabulary: null,
          allowLegacyCommitter: false,
        });
        if (retryAudit.reseedRequired || retryAudit.tags !== 0) {
          fail('regenerated reseed intent candidate failed metadata policy');
        }
        if (
          (await secretScan({ root: retryProjection.destination, log })) !== 0
        ) {
          fail('regenerated reseed intent candidate failed gitleaks');
        }
        await push(
          retryProjection.destination,
          reseedPushArgs({
            url: remote.url,
            expected: priorIntent.previousPublicSha,
          })
        );
      } else if (existingPublicSha !== priorIntent.publicSha) {
        fail(
          `unresolved reseed intent expected remote ${priorIntent.previousPublicSha} ` +
            `or ${priorIntent.publicSha}, found ${existingPublicSha}`
        );
      }
      await certifyPublishedRemote({
        root,
        parent,
        remote,
        expectedPublicSha: priorIntent.publicSha,
        metadataAudit,
        secretScan,
        log,
      });
      const record = await recordSourceLock(root, {
        status: 'reseeded',
        ...sourceLockEvidence(priorIntent),
      });
      await appendDeliveryMetric(root, 'public_reseed_recovered', {
        privateSha: record.privateSha,
        publicSha: record.publicSha,
        reason,
      });
      log(
        `[open-source-reseed] recovered accepted reseed ${record.publicSha.slice(0, 12)}; postconditions passed and the epoch update remains owed`
      );
      return record;
    }
    const projection = await projectPublicHistory({
      sourceRepo: root,
      sourceSha,
      destination: path.join(parent, 'public'),
      rebuildHistory: true,
    });
    if (
      !projection.metadataAudit ||
      projection.metadataAudit.reseedRequired ||
      projection.metadataAudit.tags !== 0
    ) {
      fail(
        'the reseed candidate lacks a clean whole-history metadata audit; refusing before any public ref is fetched or pushed'
      );
    }
    const commandAudit = await metadataAudit({
      repo: projection.destination,
      refs: [],
      format: 'json',
      forbiddenVocabulary: null,
      allowLegacyCommitter: false,
    });
    if (commandAudit.reseedRequired || commandAudit.tags !== 0) {
      fail(
        `the reseed metadata gate found ${commandAudit.findings.length} ` +
          `finding(s) and ${commandAudit.tags} tag(s)`
      );
    }
    const secretScanCode = await secretScan({
      root: projection.destination,
      log,
    });
    if (secretScanCode !== 0) {
      fail(
        `the pinned complete-history gitleaks gate exited ${secretScanCode}`
      );
    }
    await git(
      projection.destination,
      'fetch',
      '--quiet',
      '--no-tags',
      remote.url,
      `${PUBLIC_BRANCH}:refs/exawatt/existing-public-master`
    );
    const alreadyDescends = await git(
      projection.destination,
      'merge-base',
      '--is-ancestor',
      existingPublicSha,
      projection.publicSha
    ).then(
      () => true,
      () => false
    );
    if (alreadyDescends) {
      fail(
        'this projection fast-forwards the public remote, so a reseed would ' +
          'force for nothing. Land normally and the projector publishes it.'
      );
    }

    const dropped = await git(
      projection.destination,
      'rev-list',
      '--count',
      `${projection.publicSha}..${existingPublicSha}`
    );
    const epochUpdate = {
      schemaVersion: 1,
      sourceSha: projection.sourceSha,
      publicSha: projection.publicSha,
      metadataPolicyId: projection.metadataAudit.policyId,
      projectionContractId: projection.projectionContractId,
      reason: `Sanitized whole-history reseed: ${reason}`,
    };
    const reseedEvidence = {
      privateSha: projection.sourceSha,
      publicSha: projection.publicSha,
      previousPublicSha: existingPublicSha,
      publicRepository: remote.url,
      droppedPublicCommits: Number(dropped),
      outputCount: projection.outputCount,
      renderedVariants: projection.renderedVariants,
      skippedRevisions: projection.skippedRevisions,
      entryBoundaries: projection.entryBoundaries,
      unrenderedOutputs: projection.unrenderedOutputs.map(
        output => output.path
      ),
      reason,
      metadataPolicyId: projection.metadataAudit.policyId,
      projectionContractId: projection.projectionContractId,
      metadataCommitCount: projection.metadataAudit.commits,
      metadataTagCount: projection.metadataAudit.tags,
      completeHistoryGitleaks: 'passed',
      epochUpdateOwed: true,
      epochUpdate,
    };
    log(
      `[open-source-reseed] RESEEDING ${remote.url} ${PUBLIC_BRANCH}: ` +
        `${existingPublicSha.slice(0, 12)} is replaced by ` +
        `${projection.publicSha.slice(0, 12)} (${projection.outputCount} paths, ` +
        `${dropped} public commit(s) dropped). Reason: ${reason}`
    );
    const refsBeforePush = (await git(root, 'ls-remote', remote.url))
      .split('\n')
      .filter(Boolean);
    if (refsBeforePush.length !== 2) {
      fail(
        'additional public refs appeared after preflight; refusing the push'
      );
    }
    // Persist the exact lease/candidate before the destructive transition. If
    // the process exits after the server accepts the push, recovery still
    // knows both sides and ordinary delivery stays latched.
    await recordSourceLock(root, {
      status: 'reseed-intent',
      ...reseedEvidence,
    });
    await push(
      projection.destination,
      reseedPushArgs({ url: remote.url, expected: existingPublicSha })
    );

    await certifyPublishedRemote({
      root,
      parent,
      remote,
      expectedPublicSha: projection.publicSha,
      metadataAudit,
      secretScan,
      log,
    });

    const record = await recordSourceLock(root, {
      status: 'reseeded',
      ...reseedEvidence,
    });
    await appendDeliveryMetric(root, 'public_reseed', {
      privateSha: record.privateSha,
      publicSha: record.publicSha,
      previousPublicSha: existingPublicSha,
      reason,
    });
    log(
      `[open-source-reseed] public ${PUBLIC_BRANCH} is now ${projection.publicSha.slice(0, 12)}; ` +
        'the pair is recorded and the exact tracked epoch update is owed before ordinary delivery resumes'
    );
    return record;
  } finally {
    await lock.release();
    await rm(parent, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  assertDeliberate(options);
  const root = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  await reseedPublicRepository({
    root,
    reason: options.reason.trim(),
    source: options.source,
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
