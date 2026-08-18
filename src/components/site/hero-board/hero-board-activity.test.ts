import { describe, expect, it } from 'vitest';
import { HERO_BOARD_CAPTURE } from './capture';
import { HERO_STATUS_ORDER } from './capture-types';
import { heroActiveByZone, heroStatusIsActive } from './hero-board-activity';

/**
 * What "N active" under a Project means (ENG-031 W9).
 *
 * The label the board prints and the definition a reader would infer have to
 * be the same thing, so the definition is asserted here rather than left
 * inside a render loop.
 */
describe('hero board activity', () => {
  it('counts every status except idle as work', () => {
    const byName = Object.fromEntries(
      HERO_STATUS_ORDER.map((name, index) => [name, index])
    );
    expect(heroStatusIsActive(byName.working!)).toBe(true);
    expect(heroStatusIsActive(byName.reviewing!)).toBe(true);
    expect(heroStatusIsActive(byName.blocked!)).toBe(true);
    expect(heroStatusIsActive(byName.error!)).toBe(true);
    expect(heroStatusIsActive(byName.complete!)).toBe(true);
    expect(heroStatusIsActive(byName.idle!)).toBe(false);
  });

  it('never claims more active agents than a Project has', () => {
    const counts = heroActiveByZone(HERO_BOARD_CAPTURE);
    expect(counts).toHaveLength(HERO_BOARD_CAPTURE.zones.length);
    let total = 0;
    HERO_BOARD_CAPTURE.zones.forEach((zone, index) => {
      expect(counts[index], zone.label).toBeGreaterThanOrEqual(0);
      expect(counts[index], zone.label).toBeLessThanOrEqual(zone.agentCount);
      // A Project waiting on a person is a Project with work on it, so the
      // needs-you count can never exceed the active one.
      expect(counts[index], zone.label).toBeGreaterThanOrEqual(zone.needsYou);
      total += counts[index]!;
    });
    expect(total).toBeLessThanOrEqual(HERO_BOARD_CAPTURE.counts.agents);
  });

  it('follows the LIVE statuses when the scheduler is running', () => {
    // The board keeps turning Agents while the reader watches, so a frozen
    // number beside a changing board would be a small lie.
    const idle = HERO_STATUS_ORDER.indexOf('idle');
    const live = new Uint8Array(HERO_BOARD_CAPTURE.units.length).fill(idle);
    expect(Array.from(heroActiveByZone(HERO_BOARD_CAPTURE, live))).toEqual(
      HERO_BOARD_CAPTURE.zones.map(() => 0)
    );

    const working = HERO_STATUS_ORDER.indexOf('working');
    live.fill(working);
    expect(Array.from(heroActiveByZone(HERO_BOARD_CAPTURE, live))).toEqual(
      HERO_BOARD_CAPTURE.zones.map(zone => zone.agentCount)
    );
  });

  it('writes into a caller-owned buffer, so the frame loop allocates nothing', () => {
    const buffer = new Int32Array(HERO_BOARD_CAPTURE.zones.length);
    expect(heroActiveByZone(HERO_BOARD_CAPTURE, undefined, buffer)).toBe(
      buffer
    );
  });
});
