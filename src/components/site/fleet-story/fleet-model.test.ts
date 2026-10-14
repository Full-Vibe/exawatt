import { describe, expect, it } from 'vitest';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import {
  FLEET_MAX,
  fleetAt,
  fleetModel,
  sourceAdapterId,
  type FleetAgent,
} from './fleet-model';
import { axialKey } from './hex';

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
    !(sourceAdapterId(agent.source) in HARNESS_MARK_PATHS);

  it('runs only the product harnesses in the first Project', () => {
    const first = model.projects[0];
    const agents = model.agents.slice(first.first, first.first + first.count);
    expect(agents.some(isConcept)).toBe(false);
  });

  it('has every concept harness on the board by the hundred, a minority in Projects of their own', () => {
    const hundred = model.agents.slice(0, 100).filter(isConcept);
    expect(new Set(hundred.map(agent => agent.source)).size).toBe(4);
    expect(model.agents.filter(isConcept).length).toBeLessThan(FLEET_MAX / 2);
    for (const project of model.projects) {
      const agents = model.agents.filter(agent => agent.project === project.id);
      if (!agents.some(isConcept)) continue;
      // a Project settles on one or two harnesses, not confetti
      expect(agents.every(isConcept)).toBe(true);
      expect(new Set(agents.map(agent => agent.source)).size).toBe(2);
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
