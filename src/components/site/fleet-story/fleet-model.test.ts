import { describe, expect, it } from 'vitest';
import { FLEET_MAX, fleetAt, fleetModel } from './fleet-model';
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

  it('hugs a small fleet with one ring of territory and a ring of ghosts', () => {
    const one = fleetAt(model, 1);
    const present = model.tiles.filter(one.tilePresent);
    const ghosts = model.tiles.filter(one.tileGhost);
    expect(present).toHaveLength(7); // centre plus one ring
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every(tile => tile.ring <= 2)).toBe(true);
  });
});
