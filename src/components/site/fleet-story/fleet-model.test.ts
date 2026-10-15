import { describe, expect, it } from 'vitest';
import {
  FLEET_MAX,
  fleetAt,
  fleetModel,
  sourceAdapterId,
  type FleetAgent,
} from './fleet-model';
import { isConceptMark } from './story-marks';
import { axialKey } from '@/components/tiles/hex';

describe('study fleet model', () => {
  const model = fleetModel();

  it('lays out exactly the maximum fleet, project-major', () => {
    expect(model.agents).toHaveLength(FLEET_MAX);
    let expected = 0;
    for (const project of model.projects) {
      expect(project.first).toBe(expected);
      expected += project.count;
      for (let i = project.first; i < project.first + project.count; i += 1)
        expect(model.agents[i].project).toBe(project.id);
    }
  });

  it('never gives two Projects the same tile', () => {
    const seen = new Map<string, number>();
    for (const tile of model.tiles) {
      const key = axialKey(tile.axial);
      const owner = seen.get(key);
      expect(owner === undefined || owner === tile.project).toBe(true);
      seen.set(key, tile.project);
    }
  });

  it('is a prefix under growth: a smaller fleet never moves an agent', () => {
    const ten = fleetAt(model, 10);
    const hundred = fleetAt(model, 100);
    for (const tile of model.tiles) {
      if (ten.tileAgent(tile)) expect(hundred.tileAgent(tile)).toBe(true);
    }
    expect(ten.projects).toHaveLength(1);
    expect(fleetAt(model, 1).projects).toHaveLength(1);
    expect(fleetAt(model, FLEET_MAX).projects).toHaveLength(
      model.projects.length
    );
  });

  it('shows every signal the story needs inside the ten-agent fleet', () => {
    const statuses = new Set(
      model.agents.slice(0, 10).map(agent => agent.status)
    );
    expect(statuses.has('active')).toBe(true);
    expect(statuses.has('needs-you')).toBe(true);
    expect(statuses.has('result')).toBe(true);
    expect(statuses.has('off')).toBe(true);
  });

  // The landing and the close-ups were tuned on these ten (W15n keeps them):
  // the product's own five harnesses, two of each.
  it('opens on the ten agents the first scenes were tuned on', () => {
    expect(model.agents.slice(0, 10).map(agent => agent.source)).toEqual([
      'Claude Code',
      'OpenCode',
      'OpenClaw',
      'Codex',
      'Grok Build',
      'Claude Code',
      'OpenCode',
      'OpenClaw',
      'Codex',
      'Grok Build',
    ]);
  });

  const isConcept = (agent: FleetAgent) =>
    isConceptMark(sourceAdapterId(agent.source));

  // Two Grok Bots (W15p, operator 2026-10-14: "add in a couple of Grok Bot
  // agents") and two Gemini agents (W15q) work among the product's five in
  // the first Project, arriving with the hundred and at work, so the scene
  // that lifts work lifts them.
  it('runs the product harnesses in the first Project, with two Grok Bots and two Gemini agents at work past its first ten', () => {
    const first = model.projects[0];
    const agents = model.agents.slice(first.first, first.first + first.count);
    const counts = new Map<string, number>();
    for (const agent of agents)
      counts.set(agent.source, (counts.get(agent.source) ?? 0) + 1);
    expect(counts.get('Grok Bot')).toBe(2);
    expect(counts.get('Gemini')).toBe(2);
    const guests = agents.filter(
      agent => agent.source === 'Grok Bot' || agent.source === 'Gemini'
    );
    for (const guest of guests) {
      expect(guest.id - first.first).toBeGreaterThanOrEqual(10);
      expect(guest.status).toBe('active');
    }
    // Gemini is a harness the product runs, not a concept
    expect(guests.filter(isConcept).map(agent => agent.source)).toEqual([
      'Grok Bot',
      'Grok Bot',
    ]);
    const rotation = agents.filter(agent => !guests.includes(agent));
    expect(new Set(rotation.map(agent => agent.source)).size).toBe(5);
  });

  it('brings concept harnesses in by the hundred and all four by the whole fleet, a minority in Projects of their own', () => {
    // the first Project's two Grok Bots, and Sales's two harnesses
    const hundred = model.agents.slice(0, 100).filter(isConcept);
    expect(new Set(hundred.map(agent => agent.source)).size).toBe(3);
    const fleet = model.agents.filter(isConcept);
    expect(new Set(fleet.map(agent => agent.source)).size).toBe(4);
    expect(fleet.length).toBeLessThan(FLEET_MAX / 2);
    for (const project of model.projects) {
      // the first Project's guests are pinned above
      if (project.id === model.projects[0].id) continue;
      const agents = model.agents.filter(agent => agent.project === project.id);
      if (!agents.some(isConcept)) continue;
      // a Project settles on one or two harnesses, not confetti
      expect(agents.every(isConcept)).toBe(true);
      expect(new Set(agents.map(agent => agent.source)).size).toBe(2);
    }
  });

  // The card of an agent at work steps through its goal's way there (W15o).
  it("gives every agent its goal's steps, and a working agent a step on its way", () => {
    for (const agent of model.agents) {
      const steps = agent.steps ?? [];
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps.length).toBeLessThanOrEqual(6);
      expect(new Set(steps).size).toBe(steps.length);
      for (const step of steps) {
        expect(step.trim().length).toBeGreaterThan(0);
        expect(step).not.toContain('\u2014');
      }
      if (agent.status === 'active' || agent.status === 'fault')
        expect(steps).toContain(agent.doing);
      else expect(steps).not.toContain(agent.doing);
    }
  });

  it('hands every Project a spread of goals, not a couple', () => {
    for (const project of model.projects) {
      const goals = new Set(
        model.agents
          .filter(agent => agent.project === project.id)
          .map(agent => agent.name)
      );
      expect(goals.size).toBeGreaterThanOrEqual(6);
    }
  });

  it('hugs a small fleet with one ring of territory and a ring of ghosts', () => {
    const one = fleetAt(model, 1);
    const present = model.tiles.filter(one.tilePresent);
    const ghosts = model.tiles.filter(one.tileGhost);
    expect(present).toHaveLength(7); // centre plus one ring
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every(tile => tile.ring <= 2)).toBe(true);
  });
});
