import { describe, expect, it } from 'vitest';
import { fleetModel } from './fleet-model';
import { exemplarFor, leanBlend, STAGES, stageAt, stageBlend } from './stages';

/**
 * Constructions that make the READER the thing that fails (`marketing.md`:
 * "The reader is never the bottleneck; the tools are"). Deliberately small
 * and literal: it catches the exact shapes that once shipped. "Cannot" alone
 * is fine; "you cannot" is not.
 */
const READER_AS_BOTTLENECK = [
  'you cannot',
  "you can't",
  'you fail',
  'you are the bottleneck',
  'too many for you',
  'more than you can',
  'keep up with',
];

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

  it('shows another kind of agent in the card where the scene is about kinds', () => {
    const agents = fleetModel().agents;
    const card = (index: number) => {
      const stage = STAGES[index];
      return exemplarFor(
        agents,
        stage.count,
        stage.highlight.canon ?? null,
        stage.exemplarSource?.canon
      );
    };
    const kinds = STAGES.findIndex(stage => stage.exemplarSource?.canon);
    expect(kinds).toBeGreaterThan(0);
    const agent = agents[card(kinds)];
    // present, in the first Project the camera fits, on the scene's signal,
    // and on the harness the scene names
    expect(card(kinds)).toBeLessThan(STAGES[kinds].count);
    expect(agent.project).toBe(0);
    expect(agent.status).toBe(STAGES[kinds].highlight.canon);
    expect(agent.source).toBe(STAGES[kinds].exemplarSource?.canon);
    // and it is not the harness the one-agent scene showed
    const one = STAGES.findIndex(stage => stage.count === 1);
    expect(agents[card(one)].source).not.toBe(agent.source);
  });

  it('opens on ten agents, closes in on one, and ends on the whole fleet', () => {
    expect(STAGES[0].count).toBe(10);
    expect(Math.min(...STAGES.map(stage => stage.count))).toBe(1);
    expect(STAGES[STAGES.length - 1].count).toBe(agentsInFleet());
  });

  it('tells it as ten, one, ten, a hundred, then everything', () => {
    expect(STAGES.map(stage => stage.count)).toEqual([
      10,
      1,
      10,
      100,
      agentsInFleet(),
    ]);
  });

  it('has no launch scene, and ends on the fleet with the download over it', () => {
    expect(STAGES.map(stage => stage.id)).toEqual([
      'landing',
      'working',
      'needs-you',
      'third',
      'fleet',
    ]);
    expect(STAGES[STAGES.length - 1].cta).toBe(true);
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

describe('a lean before the page moves', () => {
  const out = { from: 0, to: 0, t: 0 };
  it('starts forward from a scene toward the next', () => {
    expect(leanBlend({ from: 2, to: 3, t: 0 }, 0.1, out)).toEqual({
      from: 2,
      to: 3,
      t: 0.1,
    });
  });
  it('starts back from a scene toward the one before', () => {
    const b = leanBlend({ from: 2, to: 3, t: 0 }, -0.1, out);
    expect(b.from).toBe(1);
    expect(b.to).toBe(2);
    expect(b.t).toBeCloseTo(0.9, 6);
  });
  it('never holds a move back behind where it has got to', () => {
    expect(leanBlend({ from: 2, to: 3, t: 0.4 }, 0.1, out).t).toBe(0.4);
    expect(leanBlend({ from: 1, to: 2, t: 0.3 }, -0.1, out).t).toBe(0.3);
  });
  it('leans forward from a scene reached from below', () => {
    // eased progress settles a hair short of 2: the blend before it, ended
    expect(leanBlend({ from: 1, to: 2, t: 1 }, 0.1, out)).toEqual({
      from: 2,
      to: 3,
      t: 0.1,
    });
    // and the last scene has nothing past it
    const last = STAGES.length - 1;
    expect(leanBlend({ from: last - 1, to: last, t: 1 }, 0.1, out)).toEqual({
      from: last - 1,
      to: last,
      t: 1,
    });
  });
  it('has no scene before the first to lean toward', () => {
    expect(leanBlend({ from: 0, to: 1, t: 0 }, -0.1, out)).toEqual({
      from: 0,
      to: 1,
      t: 0,
    });
  });
});
