#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import {
  allocateTicket,
  claimDeadTicket,
  finishTicket,
  heartbeatTicket,
  markTicketHead,
  queueHead,
  readTicket,
  updateAttempt,
} from './lib/delivery-queue.mjs';
import {
  classifyDeliveryPolicy,
  classifyDocsChecks,
  missingSurfaceGates,
  quarantinedSurfaceGates,
  surfaceGateMessage,
  runDeliveryChecks,
} from './lib/delivery-policy.mjs';
import {
  appendDeliveryMetric,
  delay,
  processExists,
} from './lib/delivery-state.mjs';
import {
  DIRECT_RECOVERY_ENV,
  FLOOR_VERIFIED_ENV,
  formatDocsCheckReport,
  runDocsChecks,
} from './lib/docs-check.mjs';
import {
  docsLaneRefusal,
  openDocsCheckout,
  syncInvokingCheckout,
} from './lib/docs-lane.mjs';

const execFileAsync = promisify(execFile);
const HEARTBEAT_INTERVAL_MS = 5_000;
const QUEUE_POLL_MS = 250;

export function parseArgs(argv) {
  const options = {
    direct: false,
    docs: false,
    dogfood: false,
    help: false,
    keepBranch: false,
    verify: [],
    waiveGate: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--direct') options.direct = true;
    else if (argument === '--docs') options.docs = true;
    else if (argument === '--dogfood') options.dogfood = true;
    else if (argument === '--keep-branch') options.keepBranch = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--verify') {
      const script = argv[index + 1];
      if (!script || script.startsWith('--')) {
        throw new Error('--verify requires a package.json script name.');
      }
      options.verify.push(script);
      index += 1;
    } else if (argument === '--waive-gate') {
      const gate = argv[index + 1];
      if (!gate || gate.startsWith('--')) {
        throw new Error('--waive-gate requires a gate id.');
      }
      options.waiveGate.push(gate);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export function parseWorktrees(output) {
  return output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map(block => {
      const entry = {};
      for (const line of block.split('\n')) {
        const separator = line.indexOf(' ');
        if (separator === -1) entry[line] = true;
        else entry[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return entry;
    });
}

function usage() {
  return `Usage: pnpm agent:land -- [--verify <package-script> ...] [--dogfood] [--keep-branch]
       pnpm agent:land -- --docs

Runs the repository-owned verification floor, admits the committed agent branch
to the local FIFO queue, and lands it without a pull request. This is the only
path that moves origin's master; the pre-push hook refuses any other push.

  --verify <script>  Add a package.json check to the repository-owned floor.
  --waive-gate <id>  Declare on purpose that a surface gate does not apply.
  --dogfood          Queue a coalescing Electron dogfood install after integration.
  --keep-branch      Keep the immutable remote attempt ref after integration.
  --docs             Land committed documentation (*.md, docs/**) from this
                     checkout: no worktree or setup, the docs checks only, and
                     a queue ticket like any other landing.
  --direct           Operator-only guarded recovery path (requires explicit env opt-in).
`;
}

async function execute(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function git(cwd, ...args) {
  return execute('git', args, cwd);
}

async function run(command, args, cwd, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    );
  });
}

async function isAncestor(cwd, ancestor, descendant) {
  try {
    await git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function requireClean(cwd, label) {
  const dirty = await git(cwd, 'status', '--porcelain');
  if (dirty)
    throw new Error(`${label} must be clean before landing.\n${dirty}`);
}

function safeRefPart(value) {
  return value.replace(/^agent\//, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function attemptRef(branch, attemptNumber) {
  return `refs/heads/agent-attempts/${safeRefPart(branch)}-${Date.now()}-${attemptNumber}-${randomUUID().slice(0, 8)}`;
}

async function changedPaths(root, base) {
  const output = await git(root, 'diff', '--name-only', `${base}...HEAD`);
  return output ? output.split('\n').filter(Boolean) : [];
}

async function pushAttempt(root, ref) {
  console.log(`[agent-land] publish immutable attempt: ${ref}`);
  await run('git', ['push', 'origin', `HEAD:${ref}`], root);
}

async function deleteAttempt(root, ref) {
  await run(
    'git',
    ['push', 'origin', '--delete', ref.replace('refs/heads/', '')],
    root
  );
}

async function reconcileDeadHead(root, head) {
  let recovered;
  try {
    recovered = await claimDeadTicket(root, head);
  } catch (error) {
    if (error?.code === 'LIVE_OWNER') {
      console.warn(`[agent-land] ${error.message}`);
      return;
    }
    throw error;
  }

  await run('git', ['fetch', 'origin', 'master'], root);
  const integrated = await isAncestor(
    root,
    recovered.attemptSha,
    'origin/master'
  );
  if (integrated) {
    await finishTicket(root, recovered, 'integrated', {
      integratedSha: recovered.attemptSha,
      recoveredAfterOwnerExit: true,
    });
    await requestCi(root, recovered.attemptSha).catch(error => {
      console.warn(
        `[agent-land] recovered integration ${recovered.id}, but CI could not be queued: ${error.message}`
      );
    });
    if (recovered.dogfood) {
      await requestDogfood(root, recovered.attemptSha).catch(error => {
        console.warn(
          `[agent-land] recovered integration ${recovered.id}, but dogfood could not be queued: ${error.message}`
        );
      });
    }
    console.log(`[agent-land] recovered integrated queue head ${recovered.id}`);
  } else {
    await finishTicket(root, recovered, 'failed', {
      reason: 'owner-process-exited',
      preservedAttemptRef: recovered.attemptRef,
    });
    console.warn(
      `[agent-land] retired dead queue head ${recovered.id}; candidate remains at ${recovered.attemptRef}`
    );
  }
}

async function bestEffortMasterSync(root) {
  const worktrees = parseWorktrees(
    await git(root, 'worktree', 'list', '--porcelain')
  );
  const master = worktrees.find(entry => entry.branch === 'refs/heads/master');
  if (!master?.worktree) return null;
  const dirty = await git(master.worktree, 'status', '--porcelain');
  if (dirty) {
    console.warn(
      '[agent-land] shared master is dirty; integration succeeded and local sync was skipped.'
    );
    return master.worktree;
  }
  try {
    await run('git', ['fetch', 'origin', 'master'], master.worktree);
    await run('git', ['merge', '--ff-only', 'origin/master'], master.worktree);
  } catch (error) {
    console.warn(
      `[agent-land] integration succeeded; shared master sync skipped: ${error.message}`
    );
  }
  return master.worktree;
}

async function requestDogfood(root, sourceSha) {
  const dogfoodQueue = await import('./lib/dogfood-queue.mjs');
  await dogfoodQueue.requestDogfoodInstall(root, sourceSha);
}

async function requestCi(root, sourceSha) {
  const ciBatch = await import('./lib/ci-batch.mjs');
  return ciBatch.requestCiBatch(root, sourceSha);
}

/**
 * The public projection (ENG-030 WP6-D). Loaded only when the integration
 * point is reached, exactly as the CI and dogfood requests are, so a landing
 * with no public remote configured pays nothing and prints nothing.
 */
async function preparePublic(root, integratedSha) {
  const publicDelivery = await import('./lib/public-delivery.mjs');
  return publicDelivery.preparePublicProjection(root, { integratedSha });
}

async function publishPublic(root, prepared) {
  const publicDelivery = await import('./lib/public-delivery.mjs');
  return publicDelivery.publishPreparedPublicProjection(root, prepared);
}

async function discardPublic(prepared) {
  const publicDelivery = await import('./lib/public-delivery.mjs');
  return publicDelivery.discardPreparedPublicProjection(prepared);
}

async function repairPublic(root, integratedSha) {
  const publicDelivery = await import('./lib/public-delivery.mjs');
  return publicDelivery.repairPublicProjectionBlocker(root, { integratedSha });
}

async function preparePublicHold(root, integratedSha) {
  const publicDelivery = await import('./lib/public-delivery.mjs');
  return publicDelivery.preparePublicMaintenanceHold(root, { integratedSha });
}

async function directLand(root, branch, options) {
  if (process.env.EXAWATT_AGENT_LAND_ALLOW_DIRECT !== '1') {
    throw new Error(
      '--direct is operator-only; set EXAWATT_AGENT_LAND_ALLOW_DIRECT=1 explicitly.'
    );
  }
  await run('git', ['fetch', 'origin', 'master'], root);
  if (!(await isAncestor(root, 'origin/master', 'HEAD'))) {
    throw new Error(
      'Direct recovery requires a current fast-forward candidate.'
    );
  }
  const lock = await acquireDeliveryLock(root);
  try {
    await run('git', ['fetch', 'origin', 'master'], root);
    if (!(await isAncestor(root, 'origin/master', 'HEAD'))) {
      throw new Error(
        'origin/master moved while the direct recovery path waited.'
      );
    }
    // The pre-push hook refuses every master push that is not agent:land's
    // own (BUG-200); this operator-gated path names the one SHA it pushes.
    await run('git', ['push', 'origin', 'HEAD:refs/heads/master'], root, {
      [DIRECT_RECOVERY_ENV]: await git(root, 'rev-parse', 'HEAD'),
    });
  } finally {
    await lock.release();
  }
  console.log(`[agent-land] direct recovery integrated ${branch}`);
}

/**
 * The docs lane's checks (BUG-200): the floor's docs subset, in parallel and
 * without a machine slot, reported and recorded like any floor check.
 */
async function runDocsLaneChecks(root, checks, { phase, onResult }) {
  const results = await runDocsChecks({ root, checks });
  process.stdout.write(formatDocsCheckReport(results));
  const evidence = [];
  for (const result of results) {
    const entry = {
      id: result.id,
      phase,
      lane: 'docs',
      status: result.status,
      durationMs: result.durationMs,
      completedAt: new Date().toISOString(),
    };
    await onResult(entry);
    evidence.push(entry);
  }
  const failed = results.filter(result => result.status !== 'passed');
  if (failed.length > 0) {
    throw new Error(
      `docs lane ${phase} checks failed: ${failed.map(result => result.id).join(', ')}. Fix the change, commit, and run \`pnpm agent:land -- --docs\` again.`
    );
  }
  return evidence;
}

function refuseDocsLaneOptions(options) {
  const combined = [
    options.direct && '--direct',
    options.dogfood && '--dogfood',
    options.verify.length > 0 && '--verify',
    options.waiveGate.length > 0 && '--waive-gate',
  ].filter(Boolean);
  if (combined.length > 0) {
    throw new Error(
      `--docs runs the docs checks only and cannot be combined with ${combined.join(', ')}.`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  // The checkout the command was run from. The worktree lane does all of its
  // work here; the docs lane only reads it and works in a temporary checkout.
  const invokingRoot = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  const invokingBranch = await git(invokingRoot, 'branch', '--show-current');
  if (options.docs) {
    refuseDocsLaneOptions(options);
  } else {
    if (!/^agent\/[a-z0-9][a-z0-9._/-]*$/.test(invokingBranch)) {
      throw new Error(
        `agent:land must run from an agent/<slug> branch; current branch is ${invokingBranch || '(detached)'}. Documentation lands from any checkout with \`pnpm agent:land -- --docs\`.`
      );
    }
    await requireClean(invokingRoot, 'Agent worktree');
  }

  const packageJson = JSON.parse(
    await readFile(path.join(invokingRoot, 'package.json'), 'utf8')
  );
  for (const script of options.verify) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      throw new Error(`package.json has no script named ${script}.`);
    }
    if (script === 'agent:land' || script === 'electron:install-dogfood') {
      throw new Error(`${script} cannot be used as a verification script.`);
    }
  }

  await run('git', ['fetch', 'origin', 'master'], invokingRoot);
  if (options.direct) {
    await directLand(invokingRoot, invokingBranch, options);
    return;
  }

  const candidateBase = await git(
    invokingRoot,
    'merge-base',
    'origin/master',
    'HEAD'
  );
  const candidateSha = await git(invokingRoot, 'rev-parse', 'HEAD');
  const files = await changedPaths(invokingRoot, candidateBase);

  // A lane is where the landing's git work happens and which checks it owes.
  // Everything after admission is shared, so a docs ticket waits, rebases,
  // re-checks and integrates exactly as a worktree ticket does.
  let lane;
  if (options.docs) {
    const refusal = docsLaneRefusal(files);
    if (refusal) throw new Error(refusal);
    const checkout = await openDocsCheckout(invokingRoot, candidateSha);
    lane = {
      kind: 'docs',
      root: checkout.root,
      branch: `docs/${invokingBranch || 'detached'}`,
      close: checkout.close,
      checksFor: changed => classifyDocsChecks(changed),
      runChecks: runDocsLaneChecks,
    };
  } else {
    // Surface gates are declared, not run here: they need a dev server the
    // floor does not own. Refuse before any expensive work so the omission is
    // loud and early rather than invisible (D51).
    const missingGates = missingSurfaceGates(files, [
      ...options.verify,
      ...options.waiveGate,
    ]);
    if (missingGates.length > 0) {
      await appendDeliveryMetric(invokingRoot, 'surface_gate_refused', {
        candidateSha,
        gates: missingGates.map(entry => entry.gate),
      });
      throw new Error(surfaceGateMessage(missingGates));
    }
    for (const entry of quarantinedSurfaceGates(files)) {
      console.warn(
        `[agent-land] ${entry.gate} is quarantined (${entry.backlogId}) — this change would otherwise owe it: ${entry.why}`
      );
      await appendDeliveryMetric(invokingRoot, 'surface_gate_quarantined', {
        candidateSha,
        gate: entry.gate,
        backlogId: entry.backlogId,
      });
    }
    if (options.waiveGate.length > 0) {
      await appendDeliveryMetric(invokingRoot, 'surface_gate_waived', {
        candidateSha,
        gates: options.waiveGate,
      });
    }
    lane = {
      kind: 'worktree',
      root: invokingRoot,
      branch: invokingBranch,
      close: async () => {},
      checksFor: (changed, extras) => classifyDeliveryPolicy(changed, extras),
      runChecks: runDeliveryChecks,
    };
  }
  try {
    await landThroughQueue({
      options,
      lane,
      invokingRoot,
      candidateBase,
      candidateSha,
      files,
    });
  } finally {
    await lane.close();
  }
}

async function landThroughQueue({
  options,
  lane,
  invokingRoot,
  candidateBase,
  candidateSha,
  files,
}) {
  const { root, branch } = lane;

  // A check that failed and then passed with the machine to itself is
  // reported, never swallowed (BUG-090). The status line carries the count so
  // a landing cannot look unconditionally clean when the floor had to re-run.
  const flakes = [];
  const recordFloorCheck = extra => async result => {
    if (result.status === 'flaked') flakes.push(result);
    await appendDeliveryMetric(root, 'floor_check', { ...extra, ...result });
  };

  const checks = lane.checksFor(files, options.verify);
  const evidence = await lane.runChecks(root, checks, {
    phase: 'candidate',
    onResult: recordFloorCheck({ candidateSha }),
  });
  await requireClean(root, 'Agent worktree after verification');

  let attemptNumber = 1;
  let ref = attemptRef(branch, attemptNumber);
  await pushAttempt(root, ref);
  let ticket = await allocateTicket(root, {
    branch,
    lane: lane.kind,
    baseSha: candidateBase,
    candidateSha,
    attemptSha: candidateSha,
    attemptRef: ref,
    attemptNumber,
    changedPaths: files,
    checks: evidence,
    dogfood: options.dogfood,
  });
  console.log(`[agent-land] admitted ticket ${ticket.number} (${ticket.id})`);

  let publicProjection = { state: 'inert' };
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const current = await readTicket(root, ticket.id);
      if (
        current &&
        !['integrated', 'failed', 'cancelled'].includes(current.status)
      ) {
        ticket = await heartbeatTicket(root, current, current.status);
      }
    } catch (error) {
      console.warn(`[agent-land] heartbeat failed: ${error.message}`);
    } finally {
      heartbeatBusy = false;
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    const announcedStaleHeads = new Set();
    while (true) {
      const head = await queueHead(root);
      if (!head)
        throw new Error(
          `Ticket ${ticket.id} disappeared from the active queue.`
        );
      if (head.id === ticket.id) break;
      if (!processExists(head.owner?.pid)) await reconcileDeadHead(root, head);
      else {
        const heartbeatAgeMs =
          Date.now() - new Date(head.owner.heartbeatAt).getTime();
        if (heartbeatAgeMs >= 60_000 && !announcedStaleHeads.has(head.id)) {
          announcedStaleHeads.add(head.id);
          console.warn(
            `[agent-land] queue head ${head.id} has a live owner (${head.owner.pid}) but no heartbeat for ${Math.round(heartbeatAgeMs / 1_000)}s; takeover is intentionally disabled.`
          );
          await appendDeliveryMetric(root, 'stale_owner', {
            ticketId: head.id,
            ownerPid: head.owner.pid,
            heartbeatAgeMs,
          });
        }
        await delay(QUEUE_POLL_MS);
      }
    }

    ticket = await markTicketHead(root, await readTicket(root, ticket.id));

    while (true) {
      ticket = await heartbeatTicket(
        root,
        await readTicket(root, ticket.id),
        'integrating'
      );
      await run('git', ['fetch', 'origin', 'master'], root);
      const remoteBase = await git(root, 'rev-parse', 'origin/master');
      if (!(await isAncestor(root, remoteBase, 'HEAD'))) {
        await appendDeliveryMetric(root, 'stale_stop', {
          ticketId: ticket.id,
          previousBaseSha: ticket.baseSha,
          currentBaseSha: remoteBase,
        });
        console.log(
          `[agent-land] ticket ${ticket.number}: rebase onto ${remoteBase.slice(0, 12)}`
        );
        try {
          await run('git', ['rebase', 'origin/master'], root);
        } catch (error) {
          await run('git', ['rebase', '--abort'], root).catch(() => {});
          throw new Error(
            `Automatic queue-head rebase conflicted: ${error.message}`
          );
        }
        attemptNumber += 1;
        const rebasedSha = await git(root, 'rev-parse', 'HEAD');
        ref = attemptRef(branch, attemptNumber);
        await pushAttempt(root, ref);
        const rebasedFiles = await changedPaths(root, remoteBase);
        const rebaseChecks = lane.checksFor(rebasedFiles);
        const rebaseEvidence = await lane.runChecks(root, rebaseChecks, {
          phase: 'rebase',
          onResult: recordFloorCheck({
            ticketId: ticket.id,
            candidateSha: rebasedSha,
          }),
        });
        await requireClean(
          root,
          'Rebased agent worktree after exact-tree floor'
        );
        ticket = await updateAttempt(root, ticket, {
          baseSha: remoteBase,
          attemptSha: rebasedSha,
          attemptRef: ref,
          attemptNumber,
          checks: rebaseEvidence,
          status: 'integrating',
        });
      }

      const integrationSha = await git(root, 'rev-parse', 'HEAD');
      const lock = await acquireDeliveryLock(root);
      const lockStartedAt = Date.now();
      let preparedPublic = null;
      try {
        await run('git', ['fetch', 'origin', 'master'], root);
        if (!(await isAncestor(root, 'origin/master', 'HEAD'))) continue;
        // A previous transient public push is repaired for the exact private
        // master that already integrated before this candidate may widen the
        // source/public split. A deterministic refusal stays latched for the
        // explicit reviewed recovery path.
        preparedPublic = await preparePublicHold(root, integrationSha);
        if (!preparedPublic) {
          await repairPublic(
            root,
            await git(root, 'rev-parse', 'origin/master')
          );
        }
        // Once a public remote exists, a deterministic projection failure is
        // discovered BEFORE private master moves. A transient push can still
        // fail after private integration (two remotes cannot be atomic), but
        // a broken classifier, renderer, or ancestry contract never creates a
        // new private/public split merely because projection used to be last.
        if (!preparedPublic) {
          preparedPublic = await preparePublic(root, integrationSha);
        }
        console.log('[agent-land] integrate: fast-forward origin/master');
        let integrated = false;
        try {
          // The floor just verified this exact SHA, so the docs pre-push hook
          // (BUG-195) excuses it rather than re-running a subset of the floor.
          // `--direct` never sets it: that path skips the floor.
          await run('git', ['push', 'origin', 'HEAD:refs/heads/master'], root, {
            [FLOOR_VERIFIED_ENV]: integrationSha,
          });
          integrated = true;
        } catch (error) {
          await run('git', ['fetch', 'origin', 'master'], root);
          integrated = await isAncestor(root, integrationSha, 'origin/master');
          if (!integrated) {
            await discardPublic(preparedPublic);
            preparedPublic = null;
            console.warn(
              `[agent-land] master moved during the final push; retrying this ticket on the new base (${error.message}).`
            );
            continue;
          }
        }
        await run('git', ['fetch', 'origin', 'master'], root);
        integrated =
          integrated &&
          (await isAncestor(root, integrationSha, 'origin/master'));
        if (!integrated) continue;
        publicProjection = await publishPublic(root, preparedPublic).catch(
          error => {
            console.warn(
              `[agent-land] integration succeeded; the public projection step failed: ${error.message}`
            );
            return { state: 'pending', reason: error.message };
          }
        );
        preparedPublic = null;
        ticket = await finishTicket(
          root,
          await readTicket(root, ticket.id),
          'integrated',
          {
            integratedSha: integrationSha,
            lockHoldMs: Date.now() - lockStartedAt,
            exactFloorSha: integrationSha,
            queueWaitMs:
              new Date(ticket.headAt).getTime() -
              new Date(ticket.admittedAt).getTime(),
            ...(publicProjection.state === 'inert'
              ? {}
              : {
                  publicState: publicProjection.state,
                  publicSha: publicProjection.publicSha ?? null,
                }),
          }
        );
        await appendDeliveryMetric(root, 'integration_lock', {
          ticketId: ticket.id,
          durationMs: Date.now() - lockStartedAt,
          // The projection is inside this lock, so its cost is stated
          // separately rather than hidden inside the hold time.
          ...(publicProjection.state === 'inert'
            ? {}
            : { publicProjectionMs: publicProjection.durationMs ?? 0 }),
        });
        break;
      } finally {
        if (preparedPublic) await discardPublic(preparedPublic).catch(() => {});
        await lock.release();
      }
    }
  } catch (error) {
    const current = await readTicket(root, ticket.id);
    if (
      current &&
      !['integrated', 'failed', 'cancelled'].includes(current.status)
    ) {
      ticket = await finishTicket(root, current, 'failed', {
        reason: error.message,
        preservedAttemptRef: current.attemptRef,
      }).catch(() => current);
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }

  const integratedSha = ticket.result.integratedSha;
  // The docs lane landed from a temporary checkout; the checkout the operator
  // ran it from moves onto the integrated commit only if nothing there would
  // be overwritten, and the shared master is then synced as usual.
  let invokingSync = null;
  if (lane.kind === 'docs') {
    invokingSync = await syncInvokingCheckout(invokingRoot, {
      candidateSha,
      integratedSha,
    });
    if (invokingSync.state === 'kept') {
      console.warn(
        `[agent-land] integrated; ${invokingRoot} was left at ${candidateSha.slice(0, 12)} because moving it would touch uncommitted edits (${invokingSync.reason}). Run \`git reset --keep origin/master\` there once they are committed.`
      );
    } else if (invokingSync.state === 'moved-on') {
      console.warn(
        `[agent-land] integrated; ${invokingRoot} has new commits since this landing started. Rebase them onto origin/master before landing them.`
      );
    }
  }
  const masterWorktree = await bestEffortMasterSync(
    lane.kind === 'docs' ? invokingRoot : root
  );
  let ciState = 'not-requested';
  try {
    const ciRequest = await requestCi(root, integratedSha);
    ciState = ciRequest.status;
  } catch (error) {
    ciState = 'queue-failed';
    console.warn(
      `[agent-land] integration succeeded, but CI could not be queued: ${error.message}`
    );
  }
  let installationState = 'not-requested';
  if (options.dogfood) {
    try {
      await requestDogfood(root, integratedSha);
      installationState = 'queued';
    } catch (error) {
      installationState = 'queue-failed';
      console.warn(
        `[agent-land] integration succeeded, but dogfood could not be queued: ${error.message}`
      );
    }
  }
  if (!options.keepBranch) {
    for (const publishedRef of ticket.attemptRefs) {
      console.log(`[agent-land] cleanup immutable attempt: ${publishedRef}`);
      await deleteAttempt(root, publishedRef).catch(error => {
        console.warn(
          `[agent-land] integrated successfully; retained ${publishedRef} because cleanup failed: ${error.message}`
        );
      });
    }
  }

  // An unconfigured public remote leaves the status line exactly as it was
  // before the projector existed; the field appears only when there is a
  // public repository to report on.
  const publicState =
    publicProjection.state === 'inert'
      ? ''
      : ` public=${publicProjection.state}`;
  const publicRecordedState =
    publicProjection.state === 'inert' || publicProjection.recorded !== false
      ? ''
      : ' public_recorded=false';
  // Absent when nothing flaked, so a clean landing reads exactly as it did
  // before the rerun existed; present, and naming the check and the files,
  // whenever evidence had to be re-run to be believed.
  const flakedState =
    flakes.length === 0
      ? ''
      : ` flaked=${flakes
          .map(
            result =>
              `${result.id}:${(result.flakedFiles ?? []).length}` +
              (result.phase === 'rebase' ? '(rebase)' : '')
          )
          .join(',')}`;
  const laneState = lane.kind === 'docs' ? ' lane=docs' : '';
  console.log(
    `[agent-land] STATUS implemented=${candidateSha.slice(0, 12)} verified=${checks.map(check => check.id).join(',')} pushed=${ticket.attemptRef} integrated=${integratedSha.slice(0, 12)} ci=${ciState} installed=${installationState}${flakedState}${publicState}${publicRecordedState}${laneState}`
  );
  for (const result of flakes) {
    for (const entry of result.flakedFiles ?? []) {
      console.log(
        `[agent-land] suspected flake: ${result.id} ${entry.file} (passed alone)`
      );
    }
  }
  if (masterWorktree && lane.kind === 'worktree') {
    console.log(
      `[agent-land] remove this worktree from ${masterWorktree}, then delete local branch ${branch}.`
    );
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(error => {
    console.error(
      `[agent-land] ${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  });
}
