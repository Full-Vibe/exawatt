import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANDIDATE_FRESH_MS,
  METRICS_TAIL_BYTES,
  TERMINAL_HISTORY_MS,
  TICKET_READ_BOUND,
  readDeliveryState,
  type SubjectRange,
} from './roadmap-landings';
import {
  METRICS_ADMITTED,
  METRICS_CANDIDATE_FAILED,
  METRICS_CANDIDATE_PASSED,
  METRICS_PROBE_CONFLICT,
  METRICS_REBASE_CHECKS,
  METRICS_TERMINAL,
  TICKET_FAILED_REBASE,
  TICKET_INTEGRATED_DOCS,
  TICKET_INTEGRATED_WORKTREE,
} from './delivery-queue.fixtures';

/**
 * The reader is exercised over the exact shapes `agent:land` writes today,
 * captured from this repository's own queue. Time is pinned to a moment just
 * after the captured events so the recency windows read as they did live.
 */
const NOW = Date.parse('2026-10-05T04:06:00.000Z');

const roots: string[] = [];

async function stateRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-delivery-')
  );
  roots.push(root);
  await fs.promises.mkdir(path.join(root, 'queue'), { recursive: true });
  return root;
}

async function writeTicket(root: string, ticket: { id: string }) {
  await fs.promises.writeFile(
    path.join(root, 'queue', `${ticket.id}.json`),
    `${JSON.stringify(ticket, null, 2)}\n`
  );
}

async function writeMetrics(root: string, events: readonly unknown[]) {
  await fs.promises.writeFile(
    path.join(root, 'metrics.jsonl'),
    events.map(event => JSON.stringify(event)).join('\n') + '\n'
  );
}

/** Subjects keyed the way a git range would resolve them. */
function subjects(table: Record<string, string>) {
  const asked: SubjectRange[] = [];
  return {
    asked,
    subjectFor: async (range: SubjectRange) => {
      asked.push(range);
      return table[range.sha] ?? null;
    },
  };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe('readDeliveryState over real queue shapes', () => {
  it('reads integrated and failed tickets with the fields the lens projects', async () => {
    const root = await stateRoot();
    await writeTicket(root, TICKET_INTEGRATED_DOCS);
    await writeTicket(root, TICKET_INTEGRATED_WORKTREE);
    await writeTicket(root, TICKET_FAILED_REBASE);
    await writeMetrics(root, [
      ...METRICS_REBASE_CHECKS,
      ...METRICS_CANDIDATE_PASSED,
      ...METRICS_ADMITTED,
      ...METRICS_TERMINAL,
    ]);
    const git = subjects({
      [TICKET_INTEGRATED_DOCS.candidateSha]:
        'docs: place unsupported-source receipt under its backlog item',
      [TICKET_INTEGRATED_WORKTREE.candidateSha]:
        'fix: preserve source notification currentness across permission reads',
      [TICKET_FAILED_REBASE.candidateSha]:
        'feat(ENG-004): the Fleet board ships close pack plus focus field',
    });

    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: git.subjectFor,
      now: () => NOW,
    });

    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.readAt).toBe(NOW);
    expect(read.unreadableTickets).toBe(0);
    expect(read.metricsAt).toBe(Date.parse(METRICS_TERMINAL[0].at));
    expect(read.candidates).toEqual([]);
    expect(read.tickets.map(ticket => ticket.number)).toEqual([574, 577, 579]);

    const failed = read.tickets[0];
    expect(failed).toMatchObject({
      id: TICKET_FAILED_REBASE.id,
      status: 'failed',
      branch: 'agent/fleet-v39-choice',
      lane: 'worktree',
      subject:
        'feat(ENG-004): the Fleet board ships close pack plus focus field',
      integratedSha: null,
      checking: false,
      held: false,
    });
    expect(failed.failureReason).toContain('did not come back');
    expect(failed.terminalAt).toBe(Date.parse(TICKET_FAILED_REBASE.terminalAt));

    const landed = read.tickets[2];
    expect(landed).toMatchObject({
      status: 'integrated',
      lane: 'docs',
      integratedSha: TICKET_INTEGRATED_DOCS.result.integratedSha,
      failureReason: null,
    });
    expect(landed.admittedAt).toBe(
      Date.parse(TICKET_INTEGRATED_DOCS.admittedAt)
    );
    expect(landed.headAt).toBe(Date.parse(TICKET_INTEGRATED_DOCS.headAt));
    // subjects are asked for the ticket's own range, base to candidate
    expect(git.asked).toContainEqual({
      base: TICKET_FAILED_REBASE.baseSha,
      sha: TICKET_FAILED_REBASE.candidateSha,
    });
  });

  it('orders in-flight tickets by number and marks a re-checking head', async () => {
    const root = await stateRoot();
    // Derived from the real worktree ticket: the shape is what agent:land
    // writes between admission and the terminal write.
    const integrating = {
      ...TICKET_INTEGRATED_WORKTREE,
      id: '00000580-aaaaaaaa',
      number: 580,
      status: 'integrating',
      terminalAt: null,
      result: null,
    };
    const queued = {
      ...TICKET_INTEGRATED_DOCS,
      id: '00000581-bbbbbbbb',
      number: 581,
      status: 'queued',
      headAt: null,
      terminalAt: null,
      result: null,
    };
    await writeTicket(root, queued);
    await writeTicket(root, integrating);
    // one rebase-phase check the head has run but not yet recorded on itself
    await writeMetrics(root, [
      { ...METRICS_REBASE_CHECKS[0], ticketId: integrating.id },
    ]);

    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.tickets.map(ticket => [ticket.number, ticket.status])).toEqual([
      [580, 'integrating'],
      [581, 'queued'],
    ]);
    expect(read.tickets[0].checking).toBe(true);
    expect(read.tickets[1].checking).toBe(false);
    expect(read.tickets[0].subject).toBeNull();
  });

  it('stops reporting a head as checking once the ticket records that check', async () => {
    const root = await stateRoot();
    const event = METRICS_REBASE_CHECKS[0];
    const recorded = {
      ...TICKET_INTEGRATED_WORKTREE,
      id: event.ticketId,
      status: 'integrating',
      terminalAt: null,
      result: null,
      checks: [
        ...TICKET_INTEGRATED_WORKTREE.checks,
        {
          id: event.id,
          phase: 'rebase',
          status: event.status,
          durationMs: event.durationMs,
          completedAt: event.completedAt,
        },
      ],
    };
    await writeTicket(root, recorded);
    await writeMetrics(root, [event]);

    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.tickets[0].checking).toBe(false);
  });

  it('reports a pre-admission floor as a candidate until it fails, conflicts, is admitted, or goes quiet', async () => {
    const root = await stateRoot();
    const now = Date.parse(METRICS_CANDIDATE_PASSED.at(-1)!.at) + 30_000;
    const passedSha = METRICS_CANDIDATE_PASSED[0].candidateSha;
    const failedSha = METRICS_CANDIDATE_FAILED[0].candidateSha;
    const conflictSha = METRICS_PROBE_CONFLICT[0].candidateSha;
    const staleSha = 'stale000000000000000000000000000000000000';
    await writeMetrics(root, [
      ...METRICS_CANDIDATE_PASSED,
      ...METRICS_CANDIDATE_FAILED,
      { ...METRICS_PROBE_CONFLICT[0], at: new Date(now - 5_000).toISOString() },
      {
        ...METRICS_CANDIDATE_PASSED[0],
        candidateSha: staleSha,
        at: new Date(now - CANDIDATE_FRESH_MS - 1).toISOString(),
      },
    ]);
    const git = subjects({
      [passedSha]: 'feat(ENG-017 S16): landings in the lens',
    });

    const running = await readDeliveryState({
      stateRoot: root,
      subjectFor: git.subjectFor,
      now: () => now,
    });
    expect(running.status).toBe('ok');
    if (running.status !== 'ok') return;
    expect(running.candidates).toEqual([
      {
        candidateSha: passedSha,
        subject: 'feat(ENG-017 S16): landings in the lens',
        at: Date.parse(METRICS_CANDIDATE_PASSED.at(-1)!.at),
        checksPassed: METRICS_CANDIDATE_PASSED.length,
      },
    ]);
    expect(running.candidates.map(c => c.candidateSha)).not.toContain(
      failedSha
    );
    expect(running.candidates.map(c => c.candidateSha)).not.toContain(
      conflictSha
    );
    expect(running.candidates.map(c => c.candidateSha)).not.toContain(staleSha);
    // a candidate's range has no recorded base
    expect(git.asked).toContainEqual({ base: null, sha: passedSha });

    // admission turns the candidate into its ticket
    await writeTicket(root, TICKET_INTEGRATED_DOCS);
    const admitted = await readDeliveryState({
      stateRoot: root,
      subjectFor: git.subjectFor,
      now: () => now,
    });
    expect(admitted.status).toBe('ok');
    if (admitted.status !== 'ok') return;
    expect(admitted.candidates).toEqual([]);
    expect(admitted.tickets.map(t => t.id)).toEqual([
      TICKET_INTEGRATED_DOCS.id,
    ]);
  });

  it('keeps recent terminal tickets and the newest landing, and drops old history', async () => {
    const root = await stateRoot();
    const old = {
      ...TICKET_INTEGRATED_DOCS,
      id: '00000100-cccccccc',
      number: 100,
      terminalAt: new Date(NOW - TERMINAL_HISTORY_MS - 60_000).toISOString(),
    };
    const oldFailed = {
      ...TICKET_FAILED_REBASE,
      id: '00000101-dddddddd',
      number: 101,
      terminalAt: new Date(NOW - TERMINAL_HISTORY_MS - 60_000).toISOString(),
    };
    await writeTicket(root, old);
    await writeTicket(root, oldFailed);
    await writeTicket(root, TICKET_FAILED_REBASE);

    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    // the newest integrated ticket is always reported, however old, so the
    // lens can say when something last landed; old failures are history
    expect(read.tickets.map(t => t.number)).toEqual([100, 574]);
    expect(read.metricsAt).toBeNull();
  });

  it('reads only the newest files of a long queue directory', async () => {
    const root = await stateRoot();
    const names: string[] = [];
    for (let number = 1; number <= TICKET_READ_BOUND + 5; number++) {
      const id = `${String(number).padStart(8, '0')}-${number.toString(16).padStart(8, '0')}`;
      names.push(id);
      await writeTicket(root, {
        ...TICKET_INTEGRATED_DOCS,
        id,
        number,
        terminalAt: new Date(NOW - 1000).toISOString(),
      });
    }
    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.tickets).toHaveLength(TICKET_READ_BOUND);
    expect(read.tickets[0].number).toBe(6);
    expect(read.tickets.at(-1)!.number).toBe(TICKET_READ_BOUND + 5);
  });

  it('reads the metrics tail from the end of a file larger than the tail', async () => {
    const root = await stateRoot();
    const filler = { ...METRICS_ADMITTED[0], at: '2026-01-01T00:00:00.000Z' };
    const fillerLine = JSON.stringify(filler);
    const count = Math.ceil(METRICS_TAIL_BYTES / fillerLine.length) + 50;
    const events = Array.from({ length: count }, () => filler);
    await writeMetrics(root, [...events, METRICS_TERMINAL[0]]);

    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    // the newest event is seen; the torn first line of the tail is dropped
    expect(read.metricsAt).toBe(Date.parse(METRICS_TERMINAL[0].at));
  });
});

describe('readDeliveryState honesty', () => {
  it('is unavailable, not empty, when the delivery directory does not exist', async () => {
    const missing = path.join(
      os.tmpdir(),
      'exawatt-delivery-missing-' + process.pid
    );
    const read = await readDeliveryState({
      stateRoot: missing,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read).toEqual({
      status: 'unavailable',
      reason: expect.stringContaining('ENOENT'),
    });
  });

  it('is unavailable when the queue cannot be listed', async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-delivery-')
    );
    roots.push(root);
    // a file where the queue directory should be: listing it is ENOTDIR
    await fs.promises.writeFile(path.join(root, 'queue'), 'not a directory');
    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('unavailable');
    if (read.status !== 'unavailable') return;
    expect(read.reason).toContain('ENOTDIR');
  });

  it('counts unreadable ticket files instead of hiding them', async () => {
    const root = await stateRoot();
    await writeTicket(root, TICKET_INTEGRATED_DOCS);
    await fs.promises.writeFile(
      path.join(root, 'queue', '00000600-torn.json'),
      '{"id": "00000600-torn", "number": 600, "status": "queu'
    );
    await fs.promises.writeFile(
      path.join(root, 'queue', '00000601-shape.json'),
      JSON.stringify({ id: '00000601-shape', number: 601, status: 'dancing' })
    );
    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.unreadableTickets).toBe(2);
    expect(read.tickets.map(t => t.id)).toEqual([TICKET_INTEGRATED_DOCS.id]);
  });

  it('reports a readable queue with no metrics file as ok with no metrics time', async () => {
    const root = await stateRoot();
    const read = await readDeliveryState({
      stateRoot: root,
      subjectFor: async () => null,
      now: () => NOW,
    });
    expect(read).toEqual({
      status: 'ok',
      readAt: NOW,
      tickets: [],
      candidates: [],
      unreadableTickets: 0,
      metricsAt: null,
    });
  });
});
