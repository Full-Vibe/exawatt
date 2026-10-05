import { describe, expect, it } from 'vitest';
import type { RoadmapItemLanding, RoadmapLensLandings } from '@exawatt/ui-model';
import {
  landingLabel,
  landingTooltip,
  landingsHeaderLine,
} from './roadmap-landing-mark';

const NOW = 10_000_000;

function landing(over: Partial<RoadmapItemLanding>): RoadmapItemLanding {
  return {
    state: 'queued',
    position: null,
    shortSha: null,
    ticketNumber: 580,
    branch: 'agent/slice',
    subject: 'feat(ENG-017): slice',
    at: NOW - 3 * 60_000,
    reason: null,
    ...over,
  };
}

function header(over: Partial<RoadmapLensLandings>): RoadmapLensLandings {
  return {
    inQueue: 0,
    checking: 0,
    head: null,
    unmatched: 0,
    lastLanded: null,
    unreadableTickets: 0,
    readAt: NOW,
    ...over,
  };
}

describe('landing mark copy carries the facts the queue knows', () => {
  it('names the queue position, the landed sha, and nothing it does not know', () => {
    expect(landingLabel(landing({ position: 2 }))).toContain('2nd');
    expect(landingLabel(landing({ state: 'queued', position: null }))).not.toMatch(/\d/);
    expect(
      landingLabel(landing({ state: 'landed', shortSha: 'fe255b1' }))
    ).toContain('fe255b1');
  });

  it('keeps the failure reason and the age on the tooltip', () => {
    const failed = landing({
      state: 'failed',
      reason: 'Automatic queue-head rebase conflicted',
      at: NOW - 40 * 60_000,
    });
    const tip = landingTooltip(failed, NOW);
    expect(tip).toContain('Automatic queue-head rebase conflicted');
    expect(tip).toContain('40m ago');
    expect(tip).toContain('580');
    expect(tip).toContain('agent/slice');
  });

  it('a pre-admission candidate has no ticket number to claim', () => {
    const tip = landingTooltip(landing({ state: 'checking', ticketNumber: null, branch: null }), NOW);
    expect(tip).not.toMatch(/Ticket \d/);
  });
});

describe('the header line', () => {
  it('counts the queue and names the head, falling back to the ticket number', () => {
    expect(
      landingsHeaderLine(
        header({
          inQueue: 3,
          checking: 1,
          head: { ticketNumber: 580, declaredId: 'ENG-017', state: 'integrating' },
        }),
        NOW
      )
    ).toBe('3 in queue · head ENG-017 · 1 checking');
    expect(
      landingsHeaderLine(
        header({ inQueue: 1, head: { ticketNumber: 582, declaredId: null, state: 'queued' } }),
        NOW
      )
    ).toContain('#582');
  });

  it('carries the age of the last landing when the queue is clear', () => {
    const line = landingsHeaderLine(
      header({ lastLanded: { shortSha: 'fe255b1', at: NOW - 2 * 3_600_000, declaredId: null } }),
      NOW
    );
    expect(line).toContain('fe255b1');
    expect(line).toContain('2h ago');
  });

  it('never hides tickets it could not read', () => {
    expect(landingsHeaderLine(header({ unreadableTickets: 2 }), NOW)).toContain('2 tickets unreadable');
  });
});
