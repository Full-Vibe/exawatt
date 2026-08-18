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
import { recordSourceLock } from './lib/public-source-lock.mjs';

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

export async function reseedPublicRepository({
  root,
  reason,
  source = null,
  log = console.log,
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

  let sourceSha = source;
  if (!sourceSha) {
    await git(root, 'fetch', '--quiet', 'origin', 'master').catch(() => {});
    sourceSha = 'origin/master';
  }

  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-reseed-'));
  const lock = await acquireDeliveryLock(root);
  try {
    const projection = await projectPublicHistory({
      sourceRepo: root,
      sourceSha,
      destination: path.join(parent, 'public'),
    });
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
    log(
      `[open-source-reseed] RESEEDING ${remote.url} ${PUBLIC_BRANCH}: ` +
        `${existingPublicSha.slice(0, 12)} is replaced by ` +
        `${projection.publicSha.slice(0, 12)} (${projection.outputCount} paths, ` +
        `${dropped} public commit(s) dropped). Reason: ${reason}`
    );
    await execFileAsync(
      'git',
      reseedPushArgs({ url: remote.url, expected: existingPublicSha }),
      { cwd: projection.destination }
    );

    const record = await recordSourceLock(root, {
      status: 'reseeded',
      privateSha: projection.sourceSha,
      publicSha: projection.publicSha,
      previousPublicSha: existingPublicSha,
      publicRepository: remote.url,
      droppedPublicCommits: Number(dropped),
      outputCount: projection.outputCount,
      renderedVariants: projection.renderedVariants,
      unrenderedOutputs: projection.unrenderedOutputs.map(
        output => output.path
      ),
      reason,
    });
    await appendDeliveryMetric(root, 'public_reseed', {
      privateSha: record.privateSha,
      publicSha: record.publicSha,
      previousPublicSha: existingPublicSha,
      reason,
    });
    log(
      `[open-source-reseed] public ${PUBLIC_BRANCH} is now ${projection.publicSha.slice(0, 12)}; the pair is recorded in the source lock`
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
