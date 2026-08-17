import { describe, expect, it } from 'vitest';
import { HERO_BOARD_CAPTURE } from './capture';
import { HERO_STATUS_ORDER } from './capture-types';
import {
  HERO_DIM,
  heroStatusNeedsHuman,
  resolveHeroHighlight,
} from './hero-board-highlight';
import { heroBoardSubjects } from './hero-board-subjects';
import { pinnedBoardBands } from '@/components/site/bands/manifest';

/**
 * What the board emphasizes, and whether it can lie (ENG-031 W4).
 */
describe('hero board highlight', () => {
  const capture = HERO_BOARD_CAPTURE;

  it('resolves every highlight a band can declare', () => {
    for (const band of pinnedBoardBands()) {
      const id = band.boardHighlight!;
      const highlight = resolveHeroHighlight(capture, id);
      expect(highlight.id, id).toBe(id);
      expect(highlight.zones.length, id).toBe(capture.zones.length);
      expect(highlight.units.length, id).toBe(capture.units.length);
      expect(highlight.subject.label.trim().length, id).toBeGreaterThan(0);
      expect(highlight.subject.detail.trim().length, id).toBeGreaterThan(0);
    }
  });

  it('leaves the whole fleet at full strength when nothing is emphasized', () => {
    const highlight = resolveHeroHighlight(capture, 'whole-fleet');
    expect([...highlight.zones].every(value => value === 1)).toBe(true);
    expect([...highlight.units].every(value => value === 1)).toBe(true);
    expect(highlight.followsStatus).toBe(false);
    expect(highlight.subject.unit).toBe(-1);
  });

  it('emphasizes exactly the agents waiting on a human, and follows them live', () => {
    const highlight = resolveHeroHighlight(capture, 'needs-you');
    // Emphasis has to track the LIVE status or it starts lying the moment the
    // scheduler turns an agent, so the resolver says so out loud.
    expect(highlight.followsStatus).toBe(true);

    const lit = capture.units.filter(
      (_, index) => highlight.units[index] === 1
    );
    expect(lit.length).toBe(capture.counts.needsYou);
    for (const unit of lit) {
      expect(heroStatusNeedsHuman(unit.status)).toBe(true);
    }
    // Every Project with someone waiting leads; the rest recede.
    capture.zones.forEach((zone, index) => {
      expect(highlight.zones[index], zone.label).toBe(
        zone.needsYou > 0 ? 1 : 0
      );
    });
    expect(highlight.subject.label).toContain(String(capture.counts.needsYou));
  });

  it('names the same Project the camera flies to', () => {
    const { teamZone } = heroBoardSubjects(capture);
    const highlight = resolveHeroHighlight(capture, 'one-project');
    const zone = capture.zones[teamZone]!;

    expect(highlight.subject.label).toBe(zone.label);
    expect(highlight.subject.detail).toContain(String(zone.agentCount));
    expect(highlight.zones[teamZone]).toBe(1);
    expect([...highlight.zones].filter(value => value === 1)).toHaveLength(1);
    capture.units.forEach((unit, index) => {
      expect(highlight.units[index]).toBe(unit.zone === teamZone ? 1 : 0);
    });
  });

  it('names the same Agent the camera flies to, and asks for its card', () => {
    const { agentUnit } = heroBoardSubjects(capture);
    const highlight = resolveHeroHighlight(capture, 'one-agent');
    const unit = capture.units[agentUnit]!;

    expect(highlight.subject.label).toBe(unit.name);
    expect(highlight.subject.detail).toContain(unit.doing);
    expect(highlight.subject.unit).toBe(agentUnit);
    expect([...highlight.units].filter(value => value === 1)).toHaveLength(1);
    expect(highlight.units[agentUnit]).toBe(1);
  });

  it('picks the busiest Project and one of its agents that needs a human', () => {
    const { teamZone, agentUnit } = heroBoardSubjects(capture);
    const busiest = Math.max(...capture.zones.map(zone => zone.agentCount));
    expect(capture.zones[teamZone]!.agentCount).toBe(busiest);
    expect(capture.units[agentUnit]!.zone).toBe(teamZone);
    expect(HERO_STATUS_ORDER[capture.units[agentUnit]!.status]).toBe('blocked');
  });

  it('never empties the board to make its point', () => {
    // A receded mark keeps a floor: the fleet is still there and still
    // running, and a board that blanks the rest is arguing something false.
    expect(HERO_DIM).toBeGreaterThan(0);
    expect(HERO_DIM).toBeLessThan(0.5);
  });

  it('falls back to the whole fleet for an unknown id', () => {
    const highlight = resolveHeroHighlight(
      capture,
      'nonsense' as Parameters<typeof resolveHeroHighlight>[1]
    );
    expect(highlight.id).toBe('whole-fleet');
  });
});
