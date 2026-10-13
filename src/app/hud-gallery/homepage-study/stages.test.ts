import { describe, expect, it } from 'vitest';
import { READER_AS_BOTTLENECK } from '@/components/site/bands/fold-copy';
import { fleetModel } from './fleet-model';
import { STAGES, stageAt, stageBlend } from './stages';

const prose = (lines: (string | undefined)[]) =>
  lines.filter(Boolean).join(' ');

describe('homepage study copy', () => {
  it('carries no em dashes in either copy set', () => {
    for (const stage of STAGES)
      for (const set of ['deck', 'canon'] as const) {
        const copy = stage.copy[set];
        expect(
          prose([copy.kicker, ...copy.headline, ...(copy.body ?? [])])
        ).not.toMatch(/—/);
      }
  });

  it('never makes the reader the bottleneck', () => {
    for (const stage of STAGES)
      for (const set of ['deck', 'canon'] as const) {
        const copy = stage.copy[set];
        const text = prose([
          copy.kicker,
          ...copy.headline,
          ...(copy.body ?? []),
        ]).toLowerCase();
        for (const phrase of READER_AS_BOTTLENECK)
          expect(text).not.toContain(phrase);
      }
  });

  it('points every dissection at a product signal', () => {
    for (const stage of STAGES.filter(stage => stage.card)) {
      expect(stage.highlight.canon).toBeDefined();
      expect(stage.highlight.deck).toBeDefined();
    }
  });

  it("has an agent to point at inside every dissection's own fleet size", () => {
    const agents = fleetModel().agents;
    for (const stage of STAGES.filter(stage => stage.card))
      for (const set of ['deck', 'canon'] as const) {
        const status = stage.highlight[set];
        const present = agents.slice(0, stage.count);
        expect(present.some(agent => agent.status === status)).toBe(true);
      }
  });

  it('opens on ten agents, closes in on one, and ends on the whole fleet', () => {
    expect(STAGES[0].count).toBe(10);
    expect(Math.min(...STAGES.map(stage => stage.count))).toBe(1);
    expect(STAGES[STAGES.length - 1].count).toBe(agentsInFleet());
  });
});

function agentsInFleet(): number {
  return fleetModel().agents.length;
}

describe('the rail', () => {
  it('holds each stage still for a quarter screen on either side of the move', () => {
    expect(stageBlend(1.0).t).toBe(0);
    expect(stageBlend(1.24).t).toBe(0);
    expect(stageBlend(1.76).t).toBe(1);
    expect(stageBlend(2.0).t).toBe(0);
    expect(stageBlend(1.5).t).toBeCloseTo(0.5, 6);
  });

  it('moves one way, never back', () => {
    let last = -1;
    for (let p = 1; p <= 2; p += 0.01) {
      const { from, to, t } = stageBlend(p);
      const value = from + (to - from) * t;
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it('switches the stage on screen at the middle of the move', () => {
    expect(stageAt(1.49)).toBe(1);
    expect(stageAt(1.51)).toBe(2);
    expect(stageAt(STAGES.length - 1)).toBe(STAGES.length - 1);
  });
});
