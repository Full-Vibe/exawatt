import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { acquireDirectoryLock } from './delivery-lock.mjs';
import {
  appendDeliveryMetric,
  deliveryStateRoot,
  processExists,
  readJson,
  writeJsonAtomic,
} from './delivery-state.mjs';

export const TERMINAL_TICKET_STATUSES = new Set([
  'integrated',
  'failed',
  'cancelled',
]);

async function paths(root) {
  const stateRoot = await deliveryStateRoot(root);
  const queue = path.join(stateRoot, 'queue');
  const locks = path.join(stateRoot, 'ticket-locks');
  await Promise.all([
    mkdir(queue, { recursive: true }),
    mkdir(locks, { recursive: true }),
  ]);
  return {
    stateRoot,
    queue,
    locks,
    admissionLock: path.join(stateRoot, 'admission.lock'),
    counter: path.join(stateRoot, 'next-ticket.json'),
  };
}

async function ticketPath(root, id) {
  return path.join((await paths(root)).queue, `${id}.json`);
}

export async function readTicket(root, id) {
  return readJson(await ticketPath(root, id));
}

export async function listTickets(root) {
  const queue = (await paths(root)).queue;
  const files = await readdir(queue);
  const tickets = await Promise.all(
    files
      .filter(file => file.endsWith('.json'))
      .map(file => readJson(path.join(queue, file)))
  );
  return tickets
    .filter(Boolean)
    .sort((left, right) => left.number - right.number);
}

export async function queueHead(root) {
  return (await listTickets(root)).find(
    ticket => !TERMINAL_TICKET_STATUSES.has(ticket.status)
  );
}

export async function isQueueDrained(root) {
  return !(await queueHead(root));
}

export async function allocateTicket(
  root,
  candidate,
  { ownerPid = process.pid, ownerToken = randomUUID() } = {}
) {
  const queuePaths = await paths(root);
  const lock = await acquireDirectoryLock(queuePaths.admissionLock, {
    description: 'delivery queue admission',
    timeoutMs: 30_000,
    pollMs: 20,
    log() {},
  });
  try {
    const counter = await readJson(queuePaths.counter, { next: 1 });
    const number = counter.next;
    const id = `${String(number).padStart(8, '0')}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const ticket = {
      schemaVersion: 1,
      id,
      number,
      revision: 1,
      status: 'queued',
      branch: candidate.branch,
      baseSha: candidate.baseSha,
      candidateSha: candidate.candidateSha,
      attemptSha: candidate.attemptSha,
      attemptRef: candidate.attemptRef,
      attemptRefs: [candidate.attemptRef],
      attemptNumber: candidate.attemptNumber ?? 1,
      changedPaths: candidate.changedPaths ?? [],
      checks: candidate.checks ?? [],
      dogfood: candidate.dogfood === true,
      owner: {
        pid: ownerPid,
        token: ownerToken,
        epoch: 1,
        heartbeatAt: now,
      },
      admittedAt: now,
      updatedAt: now,
      terminalAt: null,
      result: null,
    };
    await writeJsonAtomic(queuePaths.counter, { next: number + 1 });
    await writeJsonAtomic(path.join(queuePaths.queue, `${id}.json`), ticket);
    await appendDeliveryMetric(root, 'queue_admitted', {
      ticketId: id,
      ticketNumber: number,
      candidateSha: candidate.candidateSha,
    });
    return ticket;
  } finally {
    await lock.release();
  }
}

export async function mutateTicket(
  root,
  id,
  { ownerToken, ownerEpoch, allowTerminal = false } = {},
  mutate
) {
  const queuePaths = await paths(root);
  const lock = await acquireDirectoryLock(
    path.join(queuePaths.locks, `${id}.lock`),
    {
      description: `ticket ${id} transition`,
      timeoutMs: 30_000,
      pollMs: 20,
      log() {},
    }
  );
  try {
    const filePath = path.join(queuePaths.queue, `${id}.json`);
    const current = await readJson(filePath);
    if (!current) throw new Error(`Delivery ticket ${id} does not exist.`);
    if (TERMINAL_TICKET_STATUSES.has(current.status) && !allowTerminal) {
      throw new Error(
        `Delivery ticket ${id} is already terminal (${current.status}).`
      );
    }
    if (ownerToken && current.owner?.token !== ownerToken) {
      throw new Error(`Delivery ticket ${id} ownership token changed.`);
    }
    if (ownerEpoch && current.owner?.epoch !== ownerEpoch) {
      throw new Error(`Delivery ticket ${id} ownership epoch changed.`);
    }
    const next = await mutate(structuredClone(current));
    next.revision = current.revision + 1;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(filePath, next);
    return next;
  } finally {
    await lock.release();
  }
}

export async function heartbeatTicket(root, ticket, status = ticket.status) {
  return mutateTicket(
    root,
    ticket.id,
    { ownerToken: ticket.owner.token, ownerEpoch: ticket.owner.epoch },
    current => {
      current.status = status;
      current.owner.heartbeatAt = new Date().toISOString();
      return current;
    }
  );
}

export async function markTicketHead(root, ticket) {
  return mutateTicket(
    root,
    ticket.id,
    { ownerToken: ticket.owner.token, ownerEpoch: ticket.owner.epoch },
    current => {
      current.headAt ??= new Date().toISOString();
      current.owner.heartbeatAt = new Date().toISOString();
      return current;
    }
  );
}

export async function updateAttempt(root, ticket, attempt) {
  return mutateTicket(
    root,
    ticket.id,
    { ownerToken: ticket.owner.token, ownerEpoch: ticket.owner.epoch },
    current => {
      current.status = attempt.status ?? 'verifying';
      current.baseSha = attempt.baseSha;
      current.attemptSha = attempt.attemptSha;
      current.attemptRef = attempt.attemptRef;
      current.attemptRefs.push(attempt.attemptRef);
      current.attemptNumber = attempt.attemptNumber;
      current.checks = [...current.checks, ...(attempt.checks ?? [])];
      current.owner.heartbeatAt = new Date().toISOString();
      return current;
    }
  );
}

export async function finishTicket(root, ticket, status, result = {}) {
  if (!TERMINAL_TICKET_STATUSES.has(status)) {
    throw new Error(`${status} is not a terminal delivery status.`);
  }
  const terminal = await mutateTicket(
    root,
    ticket.id,
    { ownerToken: ticket.owner.token, ownerEpoch: ticket.owner.epoch },
    current => {
      current.status = status;
      current.terminalAt = new Date().toISOString();
      current.result = result;
      current.owner.heartbeatAt = new Date().toISOString();
      return current;
    }
  );
  await appendDeliveryMetric(root, 'queue_terminal', {
    ticketId: terminal.id,
    ticketNumber: terminal.number,
    status,
    queueWaitMs:
      new Date(terminal.terminalAt).getTime() -
      new Date(terminal.admittedAt).getTime(),
    ...result,
  });
  return terminal;
}

export async function claimDeadTicket(
  root,
  ticket,
  { ownerPid = process.pid } = {}
) {
  const ownerToken = randomUUID();
  return mutateTicket(root, ticket.id, {}, current => {
    if (processExists(current.owner?.pid)) {
      const heartbeatAgeMs =
        Date.now() - new Date(current.owner.heartbeatAt).getTime();
      const error = new Error(
        `Queue head ${current.id} is owned by live process ${current.owner.pid}; heartbeat age ${heartbeatAgeMs}ms. It was not taken over.`
      );
      error.code = 'LIVE_OWNER';
      throw error;
    }
    current.status = 'recovering';
    current.owner = {
      pid: ownerPid,
      token: ownerToken,
      epoch: (current.owner?.epoch ?? 0) + 1,
      heartbeatAt: new Date().toISOString(),
    };
    return current;
  });
}
