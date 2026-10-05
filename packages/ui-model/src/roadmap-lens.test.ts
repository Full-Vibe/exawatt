import { describe, expect, it } from 'vitest';
import { parseRoadmap, type SessionLink } from '@exawatt/core';
import type {
  RoadmapDeliveryCandidate,
  RoadmapDeliveryRead,
  RoadmapDeliveryTicket,
} from '@exawatt/core/desktop-bridge';
import {
  RECENT_LANDING_MS,
  buildRoadmapLens,
  landingOwner,
  type RoadmapLensSessionInput,
} from './roadmap-lens';

const SAMPLE = `## Now

### ENG-016 Daily-driver adoption

Status: active-build — in flight.

Milestones:

- [x] D0 Baseline gates
- [ ] D7 Product-grade updates
- W0.5 Spatial cockpit (rescoped 2026-07 — replaced by exposé)

### ENG-017 Project roadmap lens

## Next

### ENG-018 Durable sessions

Status: blocked — waiting on ENG-016.

## Later

### ENG-004 Spatial board

## Shipped

### ENG-001 Consolidation
`;

const doc = parseRoadmap(SAMPLE, {
  projectDir: '/repo',
  file: 'ROADMAP.md',
  now: () => 0,
});

function session(id: string, title = `tab ${id}`): RoadmapLensSessionInput {
  return {
    sessionId: id,
    tabId: `tab-${id}`,
    title,
    harness: 'claude',
    needsAttention: false,
    startedAt: null,
    turnState: 'waiting',
  };
}

function link(sessionId: string, itemId: string): SessionLink {
  return {
    sessionId,
    tabId: `tab-${sessionId}`,
    projectDir: '/repo',
    itemId,
    method: 'inferred',
    confidence: 'high',
    evidence: [
      { kind: 'branch-name', excerpt: `branch "${itemId.toLowerCase()}-x"` },
    ],
    evaluatedAt: 0,
  };
}

describe('buildRoadmapLens', () => {
  it('groups the queue and crowns the first now item as the station', () => {
    const view = buildRoadmapLens({ read: { status: 'ok', doc, mtimeMs: 42 } });
    expect(view.status).toBe('ok');
    expect(view.now.map(i => i.id)).toEqual(['ENG-016', 'ENG-017']);
    expect(view.now[0].isNowStation).toBe(true);
    expect(view.now[1].isNowStation).toBe(false);
    expect(view.now[0].displayStatus).toBe('active');
    expect(view.now[0].milestonesDone).toBe(1);
    // retired milestones leave the fraction entirely: 1/2, not 1/3
    expect(view.now[0].milestonesTotal).toBe(2);
    expect(view.next.map(i => i.id)).toEqual(['ENG-018']);
    expect(view.next[0].blocked).toBe(true);
    expect(view.shipped.map(i => i.id)).toEqual(['ENG-001']);
    expect(view.queueEmpty).toBe(false);
    expect(view.trust).toMatchObject({
      file: 'ROADMAP.md',
      itemCount: 5,
      warningCount: 0,
    });
  });

  it('attaches linked sessions as chips and keeps unlinked ones unmapped', () => {
    const sessions = [session('a'), session('b'), session('c')];
    const links = [link('a', 'ENG-016'), link('b', 'ENG-999')];
    const view = buildRoadmapLens({
      read: { status: 'ok', doc, mtimeMs: 0 },
      sessions,
      links,
    });
    expect(view.now[0].chips.map(c => c.sessionId)).toEqual(['a']);
    expect(view.now[0].chips[0].method).toBe('inferred');
    // b's link points at an item the doc no longer has; c has no link at all
    expect(view.unmappedSessions.map(s => s.sessionId)).toEqual(['b', 'c']);
  });

  it('flags queueEmpty when nothing unfinished remains', () => {
    const done = parseRoadmap(`## Shipped\n\n### A-1 Done thing\n`, {
      projectDir: '/repo',
      file: 'ROADMAP.md',
      now: () => 0,
    });
    const view = buildRoadmapLens({
      read: { status: 'ok', doc: done, mtimeMs: 0 },
    });
    expect(view.queueEmpty).toBe(true);
    expect(view.shipped).toHaveLength(1);
  });

  it('passes through none and error reads with sessions kept visible', () => {
    const none = buildRoadmapLens({
      read: { status: 'none', checked: ['ROADMAP.md'] },
      sessions: [session('a')],
    });
    expect(none.status).toBe('none');
    expect(none.checkedPaths).toEqual(['ROADMAP.md']);
    expect(none.unmappedSessions).toHaveLength(1);

    const err = buildRoadmapLens({ read: { status: 'error', error: 'boom' } });
    expect(err.status).toBe('error');
    expect(err.error).toBe('boom');
  });

  it('badges the item whose source lines carry parser warnings', () => {
    const warnDoc = parseRoadmap(
      `## Now\n\n### A-1 Thing\n\nStatus: someday — unknown token.\n`,
      { projectDir: '/repo', file: 'ROADMAP.md', now: () => 0 }
    );
    const view = buildRoadmapLens({
      read: { status: 'ok', doc: warnDoc, mtimeMs: 0 },
    });
    expect(view.now[0].hasWarnings).toBe(true);
    expect(view.trust?.warningCount).toBe(1);
  });
});

describe('landings in the lens (S16)', () => {
  const READ_AT = 10_000_000;
  const ticket = (
    over: Partial<RoadmapDeliveryTicket> &
      Pick<RoadmapDeliveryTicket, 'number' | 'status' | 'subject'>
  ): RoadmapDeliveryTicket => ({
    id: `${String(over.number).padStart(8, '0')}-fixture`,
    branch: `agent/t${over.number}`,
    lane: 'worktree',
    admittedAt: READ_AT - 120_000,
    headAt: null,
    terminalAt: null,
    integratedSha: null,
    failureReason: null,
    checking: false,
    held: false,
    ...over,
  });
  const queue = (
    tickets: RoadmapDeliveryTicket[],
    candidates: RoadmapDeliveryCandidate[] = [],
    unreadableTickets = 0
  ): Extract<RoadmapDeliveryRead, { status: 'ok' }> => ({
    status: 'ok',
    readAt: READ_AT,
    tickets,
    candidates,
    unreadableTickets,
    metricsAt: READ_AT,
  });
  const lensWith = (landings: RoadmapDeliveryRead | null) =>
    buildRoadmapLens({ read: { status: 'ok', doc, mtimeMs: 0 }, landings });
  const landingOf = (view: ReturnType<typeof lensWith>, id: string) =>
    [...view.now, ...view.next, ...view.later, ...view.shipped].find(
      item => item.declaredId === id
    )?.landing ?? null;

  it('names the owning item by the first id in the first commit subject', () => {
    const items = lensWith(null);
    const all = [...items.now, ...items.next, ...items.later, ...items.shipped];
    expect(landingOwner('feat(ENG-017 S16): landings', all)?.declaredId).toBe(
      'ENG-017'
    );
    expect(
      landingOwner('fix(ENG-018, ENG-016 D9): both', all)?.declaredId
    ).toBe('ENG-018');
    expect(landingOwner('docs: tidy the roadmap', all)).toBeNull();
    expect(landingOwner(null, all)).toBeNull();
    // whole-token only: ENG-01 names nothing, and ENG-0160 is not ENG-016
    expect(landingOwner('fix(ENG-01): x', all)).toBeNull();
    expect(landingOwner('fix(ENG-0160): x', all)).toBeNull();
  });

  it('skips an id that resolves to more than one item', () => {
    const dup = parseRoadmap(
      `## Now\n\n### ENG-001 One\n\n### ENG-001 Two\n\n## Next\n\n### ENG-002 Clear\n`,
      { projectDir: '/repo', file: 'ROADMAP.md', now: () => 0 }
    );
    const view = buildRoadmapLens({
      read: { status: 'ok', doc: dup, mtimeMs: 0 },
      landings: queue([
        ticket({
          number: 1,
          status: 'queued',
          subject: 'feat(ENG-001): ambiguous',
        }),
        ticket({
          number: 2,
          status: 'queued',
          subject: 'feat(ENG-002): clear',
        }),
      ]),
    });
    expect(view.now.map(item => item.landing)).toEqual([null, null]);
    expect(view.next[0].landing).toMatchObject({
      state: 'queued',
      position: 2,
    });
    expect(view.landings).toMatchObject({ inQueue: 2, unmatched: 1 });
  });

  it('projects queue positions, head state, and the header summary', () => {
    const view = lensWith(
      queue(
        [
          ticket({
            number: 580,
            status: 'integrating',
            subject: 'feat(ENG-016 D9): head',
            headAt: READ_AT - 20_000,
            checking: true,
          }),
          ticket({
            number: 581,
            status: 'queued',
            subject: 'fix(ENG-018): second',
          }),
          ticket({
            number: 582,
            status: 'queued',
            subject: 'docs: unmatched third',
          }),
        ],
        [
          {
            candidateSha: 'c'.repeat(40),
            subject: 'feat(ENG-004): early',
            at: READ_AT - 5_000,
            checksPassed: 2,
          },
        ]
      )
    );
    expect(landingOf(view, 'ENG-016')).toMatchObject({
      state: 'checking',
      position: 1,
      ticketNumber: 580,
      at: READ_AT - 20_000,
    });
    expect(landingOf(view, 'ENG-018')).toMatchObject({
      state: 'queued',
      position: 2,
    });
    expect(landingOf(view, 'ENG-004')).toMatchObject({
      state: 'checking',
      position: null,
      ticketNumber: null,
      branch: null,
    });
    expect(view.landings).toEqual({
      inQueue: 3,
      checking: 1,
      head: { ticketNumber: 580, declaredId: 'ENG-016', state: 'checking' },
      unmatched: 1,
      lastLanded: null,
      unreadableTickets: 0,
      readAt: READ_AT,
    });
  });

  it('shows landed with the short sha and failed with its reason, then lets them age out', () => {
    const landedAt = READ_AT - 60_000;
    const read = queue([
      ticket({
        number: 570,
        status: 'integrated',
        subject: 'feat(ENG-017): landed',
        terminalAt: landedAt,
        integratedSha: 'fe255b13b1d97fccd37aef311555d003b9d96b8f',
      }),
      ticket({
        number: 571,
        status: 'failed',
        subject: 'feat(ENG-018): failed',
        terminalAt: READ_AT - 30_000,
        failureReason: 'Automatic queue-head rebase conflicted',
      }),
    ]);
    const view = lensWith(read);
    expect(landingOf(view, 'ENG-017')).toMatchObject({
      state: 'landed',
      shortSha: 'fe255b1',
      at: landedAt,
    });
    expect(landingOf(view, 'ENG-018')).toMatchObject({
      state: 'failed',
      reason: 'Automatic queue-head rebase conflicted',
    });
    expect(view.landings?.lastLanded).toEqual({
      shortSha: 'fe255b1',
      at: landedAt,
      declaredId: 'ENG-017',
    });

    const later = lensWith({
      ...read,
      readAt: READ_AT + RECENT_LANDING_MS + 1,
    });
    expect(landingOf(later, 'ENG-017')).toBeNull();
    expect(landingOf(later, 'ENG-018')).toBeNull();
    // the header still says what last landed, with its own time
    expect(later.landings?.lastLanded?.shortSha).toBe('fe255b1');
  });

  it('prefers the in-flight ticket over a candidate over a recent landing on one item', () => {
    const view = lensWith(
      queue(
        [
          ticket({
            number: 560,
            status: 'integrated',
            subject: 'feat(ENG-017): first slice',
            terminalAt: READ_AT - 10_000,
            integratedSha: 'a'.repeat(40),
          }),
          ticket({
            number: 561,
            status: 'queued',
            subject: 'feat(ENG-017): second slice',
          }),
        ],
        [
          {
            candidateSha: 'b'.repeat(40),
            subject: 'feat(ENG-017): third',
            at: READ_AT,
            checksPassed: 1,
          },
        ]
      )
    );
    expect(landingOf(view, 'ENG-017')).toMatchObject({
      state: 'queued',
      ticketNumber: 561,
    });
  });

  it('shows nothing, not an empty queue, when the queue is unavailable or absent', () => {
    const unavailable = lensWith({ status: 'unavailable', reason: 'no queue' });
    expect(unavailable.landings).toBeNull();
    expect(
      [...unavailable.now, ...unavailable.next].every(
        item => item.landing === null
      )
    ).toBe(true);
    expect(lensWith(null).landings).toBeNull();

    const empty = lensWith(queue([], [], 2));
    expect(empty.landings).toEqual({
      inQueue: 0,
      checking: 0,
      head: null,
      unmatched: 0,
      lastLanded: null,
      unreadableTickets: 2,
      readAt: READ_AT,
    });
  });
});
